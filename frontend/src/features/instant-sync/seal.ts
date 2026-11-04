// End-to-end encryption between the browser and the enclave. TLS terminates on the parent
// instance (Caddy), so it does not protect data from the operator; this layer does.
//
// register: ephemeral ECDH P-256 with the enclave key → HKDF-SHA256(salt = SHA-256(enclave SPKI),
//           info = REGISTER_INFO) → AES-256-GCM over {ufvk, birthday, stateKey}.
// state:    the enclave encrypts each /v1/state body with stateKey (AES-256-GCM, aad = STATE_INFO).
// Must match instant-sync-server/sealed.mjs.

export const REGISTER_INFO = "zeno-instant-sync/v1/register";
export const STATE_INFO = "zeno-instant-sync/v1/state";

export type SealedBox = { epk: string; iv: string; ct: string };
export type SealedState = { iv: string; ct: string };

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

export function b64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s);
}

export function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** Encrypt `message` to the enclave key. Returns the box and a fresh 32-byte state key inside it. */
export async function sealToEnclave(enclaveSpki: Uint8Array, message: Record<string, unknown>): Promise<{ box: SealedBox; stateKey: Uint8Array }> {
  const s = subtle();
  const enclaveKey = await s.importKey("spki", buf(enclaveSpki), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = (await s.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const shared = await s.deriveBits({ name: "ECDH", public: enclaveKey }, eph.privateKey, 256);
  const ikm = await s.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const salt = await s.digest("SHA-256", buf(enclaveSpki));
  const aes = await s.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode(REGISTER_INFO) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const stateKey = randomBytes(32);
  const iv = randomBytes(12);
  const plaintext = enc.encode(JSON.stringify({ ...message, stateKey: b64(stateKey) }));
  const ct = new Uint8Array(
    await s.encrypt({ name: "AES-GCM", iv: buf(iv), additionalData: enc.encode(REGISTER_INFO) }, aes, plaintext),
  );
  const epk = new Uint8Array(await s.exportKey("raw", eph.publicKey));
  return { box: { epk: b64(epk), iv: b64(iv), ct: b64(ct) }, stateKey };
}

export async function openState<T>(stateKey: Uint8Array, sealed: SealedState): Promise<T> {
  const s = subtle();
  const key = await s.importKey("raw", buf(stateKey), "AES-GCM", false, ["decrypt"]);
  const pt = await s.decrypt(
    { name: "AES-GCM", iv: buf(unb64(sealed.iv)), additionalData: enc.encode(STATE_INFO) },
    key,
    buf(unb64(sealed.ct)),
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
