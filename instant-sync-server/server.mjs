#!/usr/bin/env node
// Instant Sync server (v0, testnet). Keeps view-only wallets synced with zcash-devtool
// and serves the cached balance + tx list instantly. Node 22 built-ins only.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

import { createEnclaveKey, sealState } from "./sealed.mjs";

const require = createRequire(import.meta.url);

// ── Config ───────────────────────────────────────────────────────────────────
const env = process.env;
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
export const config = {
  port: num(env.PORT, 8790),
  host: env.HOST || "0.0.0.0",
  devtoolBin: env.DEVTOOL_BIN || "zcash-devtool",
  dataDir: path.resolve(env.DATA_DIR || "./data"),
  lwdServer: env.LWD_SERVER || "zecrocks",
  syncIntervalMs: num(env.SYNC_INTERVAL_MS, 30_000),
  syncConcurrency: Math.max(1, num(env.SYNC_CONCURRENCY, 1)),
  allowedOrigin: env.ALLOWED_ORIGIN || "http://localhost:3000",
  maxAccounts: num(env.MAX_ACCOUNTS, 100),
  allowMainnet: env.ALLOW_MAINNET === "1",
  initTimeoutMs: num(env.INIT_TIMEOUT_MS, 120_000),
  syncTimeoutMs: num(env.SYNC_TIMEOUT_MS, 15 * 60_000),
  cmdTimeoutMs: num(env.CMD_TIMEOUT_MS, 60_000),
  registerPerHour: num(env.REGISTER_PER_HOUR, 5),
  trustProxy: env.TRUST_PROXY === "1",
  // Match the local wallet service (1 confirmation on testnet) so balances reconcile.
  minConfirmations: num(env.BALANCE_MIN_CONFIRMATIONS, 1),
  // Nitro Enclave mode: attestation documents come from the NSM via ATTEST_BIN, and
  // plaintext viewing keys are refused (they would have crossed the operator's TLS proxy).
  enclave: env.ENCLAVE === "1",
  attestBin: env.ATTEST_BIN || "zeno-enclave-agent",
  requireSealed: env.REQUIRE_SEALED !== undefined ? env.REQUIRE_SEALED === "1" : env.ENCLAVE === "1",
};

/** In-memory only. Its public key is bound into every attestation document. */
const enclaveKey = createEnclaveKey();

const MAX_BODY = 8 * 1024;
const WALLETS = path.join(config.dataDir, "wallets");
const STATE_FILE = path.join(config.dataDir, "accounts.json");

// ── Redaction: never log viewing keys or tokens ──────────────────────────────
const KEY_RE = /\b(?:uview(?:test)?1|uivk(?:test)?1|zxview\w*|secret-extended-key\w*|usk\w*)[0-9a-z-]{8,}/gi;
const BEARER_RE = /Bearer\s+[A-Za-z0-9_-]+/g;
export function redact(text) {
  return String(text ?? "")
    .replace(KEY_RE, "[redacted-key]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, "[redacted-token]")
    .slice(0, 500);
}
const log = (...parts) => console.log(new Date().toISOString(), ...parts.map(redact));

// ── Storage ──────────────────────────────────────────────────────────────────
/** id -> account. Only sha256(token)-derived id is stored, never the token or UFVK. */
const accounts = new Map();

function ensureDirs() {
  fs.mkdirSync(WALLETS, { recursive: true, mode: 0o700 });
  fs.chmodSync(config.dataDir, 0o700);
  fs.chmodSync(WALLETS, 0o700);
}

function publicFields(a) {
  return {
    id: a.id,
    status: a.status,
    initialized: a.initialized,
    createdAt: a.createdAt,
    lastSyncedAt: a.lastSyncedAt,
    lastSyncMs: a.lastSyncMs,
    firstSyncMs: a.firstSyncMs,
    balance: a.balance,
    txs: a.txs,
    chainTipHeight: a.chainTipHeight,
    error: a.error,
    // Needed to answer /v1/state after a restart. Same trust level as the UFVK in the wallet dir.
    stateKey: a.stateKey ? a.stateKey.toString("base64") : null,
  };
}

let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const tmp = `${STATE_FILE}.tmp`;
    const body = JSON.stringify([...accounts.values()].map(publicFields), null, 2);
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
  }, 50);
}

function load() {
  if (!fs.existsSync(STATE_FILE)) return;
  try {
    for (const row of JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))) {
      if (!/^[0-9a-f]{32}$/.test(row.id)) continue;
      if (!fs.existsSync(path.join(WALLETS, row.id))) continue;
      accounts.set(row.id, {
        ...row,
        stateKey: row.stateKey ? Buffer.from(row.stateKey, "base64") : null,
        status: row.initialized ? (row.lastSyncedAt ? "ready" : "syncing") : "error",
        error: row.initialized ? row.error ?? null : "Registration did not finish. Register again.",
        child: null,
        busy: false,
        queued: false,
      });
    }
  } catch (error) {
    log("could not load accounts.json:", error.message);
  }
}

// ── Child processes (spawn, never a shell) ───────────────────────────────────
function run(account, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.devtoolBin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    if (account) account.child = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`zcash-devtool ${args[3] ?? args[2]} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      if (account) account.child = null;
      reject(new Error(`could not start zcash-devtool: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (account) account.child = null;
      if (code === 0) resolve(stdout);
      else reject(new Error(redact(stderr.trim() || `exit ${code ?? signal}`)));
    });
  });
}

/**
 * zcash-devtool `list-tx --json` only returns txid + height. Read amounts from
 * the wallet's `data.sqlite` `v_transactions` view when Node's sqlite is available.
 */
export function enrichTxAmounts(walletDir, txs) {
  if (!Array.isArray(txs) || txs.length === 0) return txs;
  const dbPath = path.join(walletDir, "data.sqlite");
  if (!fs.existsSync(dbPath)) return txs;
  try {
    // Node 22+: node:sqlite. Optional — fall back to txid-only if unavailable.
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `SELECT lower(hex(txid)) AS txid_hex,
                  mined_height,
                  account_balance_delta,
                  total_received,
                  is_shielding,
                  pool_crossing_value
           FROM v_transactions
           ORDER BY mined_height DESC NULLS FIRST
           LIMIT 100`,
        )
        .all();
      const byInternal = new Map();
      for (const row of rows) {
        // SQLite hex() is internal byte order; reverse for display txid.
        const hex = String(row.txid_hex || "");
        if (hex.length !== 64) continue;
        const display = hex.match(/.{2}/g).reverse().join("");
        const delta = Number(row.account_balance_delta);
        const kind =
          row.is_shielding || row.pool_crossing_value != null
            ? "shield"
            : delta > 0
              ? "received"
              : delta < 0
                ? "sent"
                : "other";
        byInternal.set(display, {
          account_balance_delta_zatoshis: String(row.account_balance_delta),
          total_received_zatoshis: String(row.total_received ?? "0"),
          kind,
          mined_height: row.mined_height ?? null,
        });
      }
      return txs.map((tx) => {
        const extra = byInternal.get(String(tx.txid).toLowerCase());
        return extra ? { ...tx, ...extra } : tx;
      });
    } finally {
      db.close();
    }
  } catch (error) {
    log("history amount enrich skipped:", error.message);
    return txs;
  }
}

/** Parse the JSON payload from devtool stdout, tolerating log lines around it. */
export function parseJsonOutput(stdout) {
  const text = String(stdout).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{]/);
    if (start >= 0) {
      for (let end = text.length; end > start; end--) {
        const ch = text[end - 1];
        if (ch !== "}" && ch !== "]") continue;
        try {
          return JSON.parse(text.slice(start, end));
        } catch {
          // keep shrinking
        }
      }
    }
  }
  throw new Error("zcash-devtool did not print JSON");
}

const walletArgs = (a) => ["wallet", "-w", path.join(WALLETS, a.id)];

async function initAccount(a, ufvk, birthday) {
  const args = [...walletArgs(a), "init-fvk", "--name", `acct-${a.id.slice(0, 8)}`, "--fvk", ufvk];
  if (birthday !== undefined) args.push("--birthday", String(birthday));
  args.push("-s", config.lwdServer);
  await run(a, args, config.initTimeoutMs);
  a.initialized = true;
}

async function syncAccount(a) {
  const started = Date.now();
  await run(a, [...walletArgs(a), "sync", "-s", config.lwdServer], config.syncTimeoutMs);
  if (!accounts.has(a.id)) return; // deleted mid-sync
  const balanceArgs = [...walletArgs(a), "balance", "--json"];
  if (config.minConfirmations > 0) balanceArgs.push("--min-confirmations", String(config.minConfirmations));
  const balance = parseJsonOutput(await run(a, balanceArgs, config.cmdTimeoutMs));
  const txs = parseJsonOutput(await run(a, [...walletArgs(a), "list-tx", "--json"], config.cmdTimeoutMs));
  if (!accounts.has(a.id)) return;
  const ms = Date.now() - started;
  a.balance = {
    total: String(balance.total ?? "0"),
    ironwood_spendable: String(balance.ironwood_spendable ?? "0"),
    orchard_spendable: String(balance.orchard_spendable ?? "0"),
    sapling_spendable: String(balance.sapling_spendable ?? "0"),
    transparent_spendable: String(balance.transparent_spendable ?? "0"),
  };
  a.chainTipHeight = balance.chain_tip_height ?? null;
  const listed = Array.isArray(txs)
    ? txs
        .filter((t) => t && typeof t.txid === "string")
        .map((t) => ({
          txid: t.txid,
          mined_height: t.mined_height ?? null,
          account_balance_delta_zatoshis: null,
          total_received_zatoshis: null,
          kind: null,
        }))
    : [];
  a.txs = enrichTxAmounts(path.join(WALLETS, a.id), listed);
  a.lastSyncedAt = Date.now();
  a.lastSyncMs = ms;
  if (a.firstSyncMs == null) a.firstSyncMs = a.lastSyncedAt - a.createdAt;
  a.status = "ready";
  a.error = null;
}

// ── Queue with per-account lock ──────────────────────────────────────────────
const queue = [];
let running = 0;

function enqueue(a, job) {
  if (a.queued || a.busy) return;
  a.queued = true;
  queue.push({ id: a.id, job });
  pump();
}

function pump() {
  while (running < config.syncConcurrency && queue.length) {
    const { id, job } = queue.shift();
    const a = accounts.get(id);
    if (!a) continue;
    a.queued = false;
    if (a.busy) continue;
    a.busy = true;
    running++;
    if (a.status !== "registering") a.status = a.lastSyncedAt ? a.status : "syncing";
    job(a)
      .catch((error) => {
        if (!accounts.has(a.id)) return;
        a.error = redact(error.message);
        if (!a.initialized || !a.lastSyncedAt) a.status = "error";
        log(`account ${a.id.slice(0, 8)}: ${a.error}`);
      })
      .finally(() => {
        a.busy = false;
        running--;
        if (accounts.has(a.id)) persist();
        pump();
      });
  }
}

let worker = null;
function startWorker() {
  worker = setInterval(() => {
    for (const a of accounts.values()) if (a.initialized) enqueue(a, syncAccount);
  }, config.syncIntervalMs);
  worker.unref();
}

// ── Attestation ──────────────────────────────────────────────────────────────
/** Ask the NSM (via the enclave agent) for a document binding our key and the client's nonce. */
function attest(nonceHex) {
  return new Promise((resolve, reject) => {
    const args = ["attest", "--nonce", nonceHex, "--public-key", enclaveKey.spki.toString("base64")];
    const child = spawn(config.attestBin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`could not start attestation agent: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const doc = stdout.trim();
      if (code === 0 && /^[A-Za-z0-9+/]+=*$/.test(doc)) resolve(doc);
      else reject(new Error(redact(stderr.trim() || `attestation agent exit ${code}`)));
    });
  });
}

// ── Validation ───────────────────────────────────────────────────────────────
export function validateUfvk(value) {
  if (typeof value !== "string") return "ufvk must be a string.";
  const key = value.trim();
  if (key.length > 4000) return "ufvk is too long.";
  if (/\s/.test(key)) return "That looks like a seed phrase. Send a viewing key only.";
  if (/^(secret|usk|zxsk|xprv|tprv)/i.test(key)) return "That is a spending key. Send a viewing key only.";
  const testnet = /^uviewtest1[02-9ac-hj-np-z]+$/.test(key);
  const mainnet = /^uview1[02-9ac-hj-np-z]+$/.test(key);
  if (testnet) return null;
  if (mainnet) return config.allowMainnet ? null : "Mainnet viewing keys are refused. Testnet only.";
  return "ufvk must be a unified full viewing key starting with uviewtest1.";
}

const tokenToId = (token) => createHash("sha256").update(token).digest("hex").slice(0, 32);

// ── HTTP ─────────────────────────────────────────────────────────────────────
const registers = new Map(); // ip -> [timestamps]
/** Counts successful registrations only: those are what spawn devtool processes. */
function rateLimited(ip) {
  const now = Date.now();
  const recent = (registers.get(ip) || []).filter((t) => now - t < 3_600_000);
  registers.set(ip, recent);
  return recent.length >= config.registerPerHour;
}
function recordRegister(ip) {
  registers.get(ip)?.push(Date.now()) ?? registers.set(ip, [Date.now()]);
}

function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || "unknown";
}

function send(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

function cors(req, res) {
  if (req.headers.origin && req.headers.origin === config.allowedOrigin) {
    res.setHeader("access-control-allow-origin", config.allowedOrigin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-control-max-age", "600");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // Stop buffering, drain the rest, and let the caller answer 413 before closing.
        req.removeAllListeners("data");
        req.resume();
        reject(Object.assign(new Error("Body too large."), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authed(req) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization || ""));
  if (!match) return null;
  return accounts.get(tokenToId(match[1])) || null;
}

async function handleRegister(req, res) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return send(res, 429, { error: "Too many registrations. Try again later." });
  if (accounts.size >= config.maxAccounts) return send(res, 503, { error: "Server is full." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    if (error.status === 413) res.setHeader("connection", "close");
    return send(res, error.status || 400, { error: error.status ? error.message : "Send JSON." });
  }
  let stateKey = null;
  if (body?.sealed !== undefined) {
    try {
      body = enclaveKey.open(body.sealed);
    } catch {
      return send(res, 400, { error: "Could not open the sealed request. Fetch a fresh attestation and retry." });
    }
    stateKey = typeof body?.stateKey === "string" ? Buffer.from(body.stateKey, "base64") : null;
    if (!stateKey || stateKey.length !== 32) return send(res, 400, { error: "sealed request needs a 32-byte stateKey." });
  } else if (config.requireSealed) {
    return send(res, 400, { error: "This server only accepts viewing keys encrypted to its attested enclave key." });
  }
  const problem = validateUfvk(body?.ufvk);
  if (problem) return send(res, 400, { error: problem });
  let birthday;
  if (body.birthday !== undefined && body.birthday !== null) {
    if (!Number.isInteger(body.birthday) || body.birthday < 1) {
      return send(res, 400, { error: "birthday must be a positive block height." });
    }
    birthday = body.birthday;
  }
  recordRegister(ip);
  const token = randomBytes(32).toString("base64url");
  const id = tokenToId(token);
  const a = {
    id,
    status: "registering",
    initialized: false,
    createdAt: Date.now(),
    lastSyncedAt: null,
    lastSyncMs: null,
    firstSyncMs: null,
    balance: null,
    txs: [],
    chainTipHeight: null,
    error: null,
    stateKey,
    child: null,
    busy: false,
    queued: false,
  };
  accounts.set(id, a);
  persist();
  const ufvk = body.ufvk.trim();
  enqueue(a, async (acct) => {
    await initAccount(acct, ufvk, birthday);
    acct.status = "syncing";
    persist();
    await syncAccount(acct);
  });
  log(`registered ${id.slice(0, 8)}`);
  return send(res, 201, { token, status: a.status });
}

function handleState(req, res) {
  const a = authed(req);
  if (!a) return send(res, 401, { error: "Unknown or missing token." });
  const state = {
    status: a.status,
    balance: a.balance,
    txs: a.txs,
    chainTipHeight: a.chainTipHeight,
    lastSyncedAt: a.lastSyncedAt,
    stalenessMs: a.lastSyncedAt ? Date.now() - a.lastSyncedAt : null,
    firstSyncMs: a.firstSyncMs,
    lastSyncMs: a.lastSyncMs,
    error: a.error,
  };
  return send(res, 200, a.stateKey ? { sealed: sealState(a.stateKey, state) } : state);
}

async function handleAttestation(url, res) {
  const nonce = url.searchParams.get("nonce") || "";
  if (!/^(?:[0-9a-f]{2}){16,64}$/.test(nonce)) return send(res, 400, { error: "nonce must be 16-64 bytes of lowercase hex." });
  if (!config.enclave) {
    // Dev server: same encryption, no proof. Clients that pin measurements refuse this.
    return send(res, 200, { attested: false, document: null, publicKey: enclaveKey.spki.toString("base64") });
  }
  try {
    return send(res, 200, { attested: true, document: await attest(nonce) });
  } catch (error) {
    log("attestation failed:", error.message);
    return send(res, 503, { error: "Attestation unavailable." });
  }
}

function handleDelete(req, res) {
  const a = authed(req);
  if (!a) return send(res, 401, { error: "Unknown or missing token." });
  accounts.delete(a.id);
  if (a.child) a.child.kill("SIGKILL");
  fs.rmSync(path.join(WALLETS, a.id), { recursive: true, force: true });
  persist();
  log(`deleted ${a.id.slice(0, 8)}`);
  return send(res, 200, { deleted: true });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      cors(req, res);
      const url = new URL(req.url, "http://x");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, accounts: accounts.size, queued: queue.length, running });
      }
      if (req.method === "GET" && url.pathname === "/v1/attestation") return await handleAttestation(url, res);
      if (req.method === "POST" && url.pathname === "/v1/register") return await handleRegister(req, res);
      if (req.method === "GET" && url.pathname === "/v1/state") return handleState(req, res);
      if (req.method === "DELETE" && url.pathname === "/v1/account") return handleDelete(req, res);
      return send(res, 404, { error: "Not found." });
    } catch (error) {
      log("request failed:", error.message);
      if (!res.headersSent) send(res, 500, { error: "Internal error." });
    }
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  ensureDirs();
  load();
  for (const a of accounts.values()) if (a.initialized) enqueue(a, syncAccount);
  startWorker();
  const server = createServer();
  server.listen(config.port, config.host, () => {
    log(`instant-sync listening on ${config.host}:${config.port} (${accounts.size} accounts, lwd=${config.lwdServer}, enclave=${config.enclave}, requireSealed=${config.requireSealed})`);
  });
  const stop = () => {
    clearInterval(worker);
    for (const a of accounts.values()) a.child?.kill("SIGKILL");
    clearTimeout(persistTimer);
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify([...accounts.values()].map(publicFields), null, 2), { mode: 0o600 });
    } catch {
      // best effort
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
