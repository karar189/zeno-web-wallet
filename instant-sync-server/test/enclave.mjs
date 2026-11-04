// Enclave-mode test: ENCLAVE=1 with a mock NSM agent. Plaintext keys must be refused.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { open, seal } from "./sealed-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "instant-sync-enc-"));
const port = 19000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const UFVK = `uviewtest1${"qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let output = "";
const server = spawn(process.execPath, [path.join(here, "..", "server.mjs")], {
  env: {
    ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, ENCLAVE: "1",
    ATTEST_BIN: path.join(here, "mock-attest.mjs"), DEVTOOL_BIN: path.join(here, "mock-devtool.mjs"), MOCK_SYNC_DELAY_MS: "200",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));
const api = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

let failed = false;
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await api("GET", "/health")).status === 200) break; } catch { await sleep(100); }
  }
  const nonce = "cd".repeat(32);
  const att = await api("GET", `/v1/attestation?nonce=${nonce}`);
  assert.equal(att.status, 200);
  assert.equal(att.json.attested, true);
  assert.equal(att.json.publicKey, undefined, "enclave mode must not hand out an unattested key");
  const doc = JSON.parse(Buffer.from(att.json.document, "base64").toString());
  assert.equal(doc.nonce, nonce);
  console.log("  ✓ attestation passes nonce + enclave public key to the NSM agent");

  const plain = await api("POST", "/v1/register", { ufvk: UFVK });
  assert.equal(plain.status, 400);
  assert.match(plain.json.error, /attested enclave key/);
  console.log("  ✓ plaintext viewing key refused");

  const { box, stateKey } = await seal(doc.publicKey, { ufvk: UFVK });
  const reg = await api("POST", "/v1/register", { sealed: box });
  assert.equal(reg.status, 201);
  let state;
  for (let i = 0; i < 50; i++) {
    state = await open(stateKey, (await api("GET", "/v1/state", null, reg.json.token)).json.sealed);
    if (state.status === "ready") break;
    await sleep(100);
  }
  assert.equal(state.status, "ready");
  assert.ok(!output.includes(UFVK), "logs leaked the UFVK");
  console.log("  ✓ sealed register → sealed state ready");
  console.log("\nenclave: PASS");
} catch (error) {
  failed = true;
  console.error("\nenclave: FAIL\n", error, "\n--- server output ---\n" + output);
} finally {
  server.kill("SIGTERM");
  await sleep(200);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
