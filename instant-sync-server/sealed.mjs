// Enclave side of the end-to-end layer. Must match frontend/src/features/instant-sync/seal.ts.
// The ECDH key pair is generated in memory at startup and never written to disk; inside a
// Nitro Enclave that means it never leaves the enclave. Its public key is bound into every
// attestation document, so a client that verified the document knows only this process can
// open what it sends.

import { createCipheriv, createDecipheriv, createECDH, createHash, createPublicKey, hkdfSync, randomBytes } from "node:crypto";

export const REGISTER_INFO = "zeno-instant-sync/v1/register";
export const STATE_INFO = "zeno-instant-sync/v1/state";

export function createEnclaveKey() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const spki = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: ecdh.getPublicKey().subarray(1, 33).toString("base64url"), y: ecdh.getPublicKey().subarray(33).toString("base64url") },
    format: "jwk",
  }).export({ type: "spki", format: "der" });
  const salt = createHash("sha256").update(spki).digest();

  return {
    spki,
    /** Decrypt a client's sealed register box. Throws on any tampering. */
    open(box) {
      if (!box || typeof box.epk !== "string" || typeof box.iv !== "string" || typeof box.ct !== "string") {
        throw new Error("sealed must be {epk, iv, ct}");
      }
      const epk = Buffer.from(box.epk, "base64");
      const iv = Buffer.from(box.iv, "base64");
      const ct = Buffer.from(box.ct, "base64");
      if (epk.length !== 65 || iv.length !== 12 || ct.length < 17) throw new Error("sealed box has bad sizes");
      const shared = ecdh.computeSecret(epk);
      const key = Buffer.from(hkdfSync("sha256", shared, salt, REGISTER_INFO, 32));
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAAD(Buffer.from(REGISTER_INFO));
      d.setAuthTag(ct.subarray(ct.length - 16));
      const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      return JSON.parse(pt.toString("utf8"));
    },
  };
}

/** Encrypt a state body to the client's state key. */
export function sealState(stateKey, body) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", stateKey, iv);
  c.setAAD(Buffer.from(STATE_INFO));
  const ct = Buffer.concat([c.update(JSON.stringify(body), "utf8"), c.final(), c.getAuthTag()]);
  return { iv: iv.toString("base64"), ct: ct.toString("base64") };
}
