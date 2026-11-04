// Smoke test: real server process + mock zcash-devtool. No network needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { open, seal } from "./sealed-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "instant-sync-"));
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const ORIGIN = "http://localhost:3000";
// Valid bech32 charset, testnet prefix. Fake key, not a real account.
const UFVK = `uviewtest1${"qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(8)}`;

let output = "";
const server = spawn(process.execPath, [path.join(root, "server.mjs")], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    DEVTOOL_BIN: path.join(here, "mock-devtool.mjs"),
    DATA_DIR: dataDir,
    SYNC_INTERVAL_MS: "1000",
    ALLOWED_ORIGIN: ORIGIN,
    MOCK_SYNC_DELAY_MS: "800",
    MOCK_IRONWOOD: "150000000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

let failed = false;
const step = (name) => console.log(`  ✓ ${name}`);
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await api("GET", "/health")).status === 200) break;
    } catch {
      await sleep(100);
    }
  }
  assert.equal((await api("GET", "/health")).json.ok, true);
  step("health");

  const reg = await api("POST", "/v1/register", { body: { ufvk: UFVK, birthday: 3_800_000 } });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.match(reg.json.token, /^[A-Za-z0-9_-]{43}$/);
  const token = reg.json.token;
  step("register → 201 + token");

  const early = await api("GET", "/v1/state", { token });
  assert.equal(early.status, 200);
  assert.ok(["registering", "syncing"].includes(early.json.status), early.json.status);
  assert.equal(early.json.balance, null);
  step(`state while syncing → ${early.json.status}`);

  let ready = null;
  for (let i = 0; i < 60 && !ready; i++) {
    const s = await api("GET", "/v1/state", { token });
    if (s.json.status === "ready") ready = s.json;
    else await sleep(200);
  }
  assert.ok(ready, "account never became ready");
  assert.equal(ready.balance.ironwood_spendable, "150000000");
  assert.equal(ready.balance.transparent_spendable, "2500");
  assert.equal(ready.txs.length, 2);
  assert.equal(typeof ready.chainTipHeight, "number");
  assert.equal(typeof ready.firstSyncMs, "number");
  assert.ok(ready.stalenessMs >= 0);
  step(`state ready → ironwood 1.5 ZEC, 2 txs, first sync ${ready.firstSyncMs} ms`);

  const t0 = performance.now();
  await api("GET", "/v1/state", { token });
  const cachedMs = performance.now() - t0;
  assert.ok(cachedMs < 100, `cached state took ${cachedMs} ms`);
  step(`cached state served in ${cachedMs.toFixed(1)} ms`);

  const tip1 = ready.chainTipHeight;
  await sleep(2500);
  const later = await api("GET", "/v1/state", { token });
  assert.ok(later.json.chainTipHeight > tip1, "background worker did not resync");
  step("background worker resynced");

  for (const [label, ufvk] of [
    ["spending key", "secret-extended-key-test1qqqqqqqqqqqqqqqqqqqqqqqqqqqq"],
    ["seed phrase", "abandon abandon abandon abandon abandon abandon"],
    ["mainnet key", `uview1${"qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(4)}`],
    ["garbage", "hello"],
  ]) {
    const bad = await api("POST", "/v1/register", { body: { ufvk } });
    assert.equal(bad.status, 400, `${label}: ${bad.status}`);
  }
  step("bad keys rejected (spending key, seed, mainnet, garbage)");

  const big = await api("POST", "/v1/register", { body: JSON.stringify({ ufvk: "x".repeat(9000) }) });
  assert.equal(big.status, 413);
  step("body > 8KB → 413");

  assert.equal((await api("GET", "/v1/state", { token: "A".repeat(43) })).status, 401);
  assert.equal((await api("GET", "/v1/state")).status, 401);
  step("wrong / missing token → 401");

  const pre = await fetch(`${base}/v1/state`, { method: "OPTIONS", headers: { origin: ORIGIN } });
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
  const evil = await fetch(`${base}/v1/state`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  step("CORS only for ALLOWED_ORIGIN");

  const stored = fs.readFileSync(path.join(dataDir, "accounts.json"), "utf8");
  assert.ok(!stored.includes(UFVK) && !stored.includes(token), "accounts.json leaked a secret");
  assert.ok(!output.includes(UFVK) && !output.includes(token), "server logs leaked a secret");
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  step("no UFVK/token in accounts.json or logs; data dir is 700");

  const walletDir = path.join(dataDir, "wallets", ready ? fs.readdirSync(path.join(dataDir, "wallets"))[0] : "");
  const del = await api("DELETE", "/v1/account", { token });
  assert.equal(del.status, 200);
  assert.equal((await api("GET", "/v1/state", { token })).status, 401);
  assert.ok(!fs.existsSync(walletDir), "wallet dir not removed");
  step("delete → 200, token revoked, wallet dir removed");

  const att = await api("GET", `/v1/attestation?nonce=${"ab".repeat(32)}`);
  assert.equal(att.status, 200);
  assert.equal(att.json.attested, false);
  assert.equal(att.json.document, null);
  assert.equal((await api("GET", "/v1/attestation?nonce=zz")).status, 400);
  const { box, stateKey } = await seal(att.json.publicKey, { ufvk: UFVK, birthday: 3_800_000 });
  const sealedReg = await api("POST", "/v1/register", { body: { sealed: box } });
  assert.equal(sealedReg.status, 201, JSON.stringify(sealedReg.json));
  const sealedToken = sealedReg.json.token;
  let opened = null;
  for (let i = 0; i < 60; i++) {
    const r = await api("GET", "/v1/state", { token: sealedToken });
    assert.ok(r.json.sealed && !("balance" in r.json), "sealed account answered in plaintext");
    opened = await open(stateKey, r.json.sealed);
    if (opened.status === "ready") break;
    await sleep(200);
  }
  assert.equal(opened.status, "ready");
  assert.equal(opened.balance.ironwood_spendable, "150000000");
  const tampered = { ...box, ct: Buffer.from(Buffer.from(box.ct, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") };
  assert.equal((await api("POST", "/v1/register", { body: { sealed: tampered } })).status, 400);
  await api("DELETE", "/v1/account", { token: sealedToken });
  step("dev attestation (unattested key) → sealed register → sealed state; tampered box → 400");

  let limited = false;
  let accepted = 2; // the two registrations above
  for (let i = 0; i < 6 && !limited; i++) {
    const r = await api("POST", "/v1/register", { body: { ufvk: UFVK } });
    if (r.status === 201) accepted++;
    limited = r.status === 429;
  }
  assert.ok(limited, "rate limit never triggered");
  assert.equal(accepted, 5, `expected 5 accepted registrations before 429, got ${accepted}`);
  step("register rate limit → 429");

  console.log("\nsmoke: PASS");
} catch (error) {
  failed = true;
  console.error("\nsmoke: FAIL\n", error);
  console.error("--- server output ---\n" + output);
} finally {
  server.kill("SIGTERM");
  await sleep(200);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
