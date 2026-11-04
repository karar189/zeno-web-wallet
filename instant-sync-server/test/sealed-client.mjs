// Node mirror of frontend/src/features/instant-sync/seal.ts, used to exercise the server.
const s = globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64 = (u) => Buffer.from(u).toString("base64");

export async function seal(spkiB64, message) {
  const spki = Buffer.from(spkiB64, "base64");
  const enclave = await s.importKey("spki", spki, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await s.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const shared = await s.deriveBits({ name: "ECDH", public: enclave }, eph.privateKey, 256);
  const ikm = await s.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const info = enc.encode("zeno-instant-sync/v1/register");
  const aes = await s.deriveKey({ name: "HKDF", hash: "SHA-256", salt: await s.digest("SHA-256", spki), info }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const stateKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await s.encrypt({ name: "AES-GCM", iv, additionalData: info }, aes, enc.encode(JSON.stringify({ ...message, stateKey: b64(stateKey) })));
  return { box: { epk: b64(new Uint8Array(await s.exportKey("raw", eph.publicKey))), iv: b64(iv), ct: b64(new Uint8Array(ct)) }, stateKey };
}

export async function open(stateKey, sealed) {
  const key = await s.importKey("raw", stateKey, "AES-GCM", false, ["decrypt"]);
  const pt = await s.decrypt({ name: "AES-GCM", iv: Buffer.from(sealed.iv, "base64"), additionalData: enc.encode("zeno-instant-sync/v1/state") }, key, Buffer.from(sealed.ct, "base64"));
  return JSON.parse(new TextDecoder().decode(pt));
}
