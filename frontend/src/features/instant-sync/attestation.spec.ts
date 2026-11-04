import * as x509 from "@peculiar/x509";
import { beforeAll, describe, expect, it } from "vitest";

import { AttestationError, toHex, verifyAttestation, type Measurements } from "./attestation";
import { encodeCbor, type CborValue } from "./cbor";
import { openState, sealToEnclave, STATE_INFO, unb64 } from "./seal";

const subtle = globalThis.crypto.subtle;
const ECDSA384 = { name: "ECDSA", namedCurve: "P-384", hash: "SHA-384" } as const;
const pcrBytes = (fill: number) => new Uint8Array(48).fill(fill);
const EXPECTED: Measurements = { pcr0: toHex(pcrBytes(1)), pcr1: toHex(pcrBytes(2)), pcr2: toHex(pcrBytes(3)) };
const NOW = Date.UTC(2026, 10, 4, 12);

type Chain = { rootDer: Uint8Array; rootSha: string; interDer: Uint8Array; leafDer: Uint8Array; leafKey: CryptoKey };
let chain: Chain;
let otherChain: Chain;

async function makeChain(): Promise<Chain> {
  const gen = () => subtle.generateKey(ECDSA384, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  const [rootKeys, interKeys, leafKeys] = await Promise.all([gen(), gen(), gen()]);
  const notBefore = new Date(NOW - 86_400_000);
  const notAfter = new Date(NOW + 86_400_000);
  const ca = [new x509.BasicConstraintsExtension(true, undefined, true)];
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01", name: "CN=test-root", notBefore, notAfter, keys: rootKeys, signingAlgorithm: ECDSA384, extensions: ca,
  });
  const inter = await x509.X509CertificateGenerator.create({
    serialNumber: "02", subject: "CN=test-inter", issuer: root.subject, notBefore, notAfter,
    publicKey: interKeys.publicKey, signingKey: rootKeys.privateKey, signingAlgorithm: ECDSA384, extensions: ca,
  });
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: "03", subject: "CN=test-leaf", issuer: inter.subject, notBefore, notAfter,
    publicKey: leafKeys.publicKey, signingKey: interKeys.privateKey, signingAlgorithm: ECDSA384,
  });
  const rootDer = new Uint8Array(root.rawData);
  return {
    rootDer,
    rootSha: toHex(new Uint8Array(await subtle.digest("SHA-256", rootDer as BufferSource))),
    interDer: new Uint8Array(inter.rawData),
    leafDer: new Uint8Array(leaf.rawData),
    leafKey: leafKeys.privateKey,
  };
}

type DocOpts = { nonce: Uint8Array; publicKey: Uint8Array; pcrs?: [Uint8Array, Uint8Array, Uint8Array]; timestamp?: number; c?: Chain; signer?: CryptoKey };

async function makeDoc(o: DocOpts): Promise<Uint8Array> {
  const c = o.c ?? chain;
  const [p0, p1, p2] = o.pcrs ?? [pcrBytes(1), pcrBytes(2), pcrBytes(3)];
  const payload = encodeCbor(
    new Map<CborValue, CborValue>([
      ["module_id", "i-test-enc0123"],
      ["digest", "SHA384"],
      ["timestamp", o.timestamp ?? NOW],
      ["pcrs", new Map<CborValue, CborValue>([[0, p0], [1, p1], [2, p2], [3, pcrBytes(0)]])],
      ["certificate", c.leafDer],
      ["cabundle", [c.rootDer, c.interDer]],
      ["public_key", o.publicKey],
      ["user_data", null],
      ["nonce", o.nonce],
    ]),
  );
  const protectedHeader = encodeCbor(new Map<CborValue, CborValue>([[1, -35]]));
  const tbs = encodeCbor(["Signature1", protectedHeader, new Uint8Array(0), payload]);
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-384" }, o.signer ?? c.leafKey, tbs as BufferSource));
  return encodeCbor({ tag: 18, value: [protectedHeader, new Map(), payload, sig] });
}

const nonce = new Uint8Array(32).fill(7);
const enclavePub = new Uint8Array([1, 2, 3]);
const verify = (doc: Uint8Array, extra: Partial<Parameters<typeof verifyAttestation>[1]> = {}) =>
  verifyAttestation(doc, { expected: EXPECTED, nonce, now: NOW, rootSha256: chain.rootSha, ...extra });

describe("verifyAttestation", () => {
  beforeAll(async () => {
    [chain, otherChain] = await Promise.all([makeChain(), makeChain()]);
  });

  it("accepts a valid document and returns the bound public key", async () => {
    const out = await verify(await makeDoc({ nonce, publicKey: enclavePub }));
    expect(Array.from(out.publicKey)).toEqual([1, 2, 3]);
    expect(out.pcrs).toEqual(EXPECTED);
  });

  it("rejects a PCR that does not match the published build", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub, pcrs: [pcrBytes(9), pcrBytes(2), pcrBytes(3)] });
    await expect(verify(doc)).rejects.toThrow(/PCR0 .* does not match/);
  });

  it("rejects a debug-mode enclave (all-zero PCRs)", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub, pcrs: [pcrBytes(0), pcrBytes(0), pcrBytes(0)] });
    await expect(verify(doc)).rejects.toThrow(/all zeros/);
  });

  it("rejects a replayed document (wrong nonce)", async () => {
    const doc = await makeDoc({ nonce: new Uint8Array(32).fill(8), publicKey: enclavePub });
    await expect(verify(doc)).rejects.toThrow(/nonce/);
  });

  it("rejects a stale document", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub, timestamp: NOW - 10 * 60_000 });
    await expect(verify(doc)).rejects.toThrow(/stale/);
  });

  it("rejects a chain that does not start at the pinned root", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub, c: otherChain });
    await expect(verify(doc)).rejects.toThrow(/AWS Nitro root/);
  });

  it("uses the real AWS root by default", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub });
    await expect(verify(doc, { rootSha256: undefined })).rejects.toThrow(/AWS Nitro root/);
  });

  it("rejects a signature by a key other than the leaf", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub, signer: otherChain.leafKey });
    await expect(verify(doc)).rejects.toThrow(/COSE signature/);
  });

  it("rejects a tampered payload (swapped public key)", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub });
    const i = doc.findIndex((_, k) => doc[k] === 0x43 && doc[k + 1] === 1 && doc[k + 2] === 2 && doc[k + 3] === 3);
    expect(i).toBeGreaterThan(0);
    doc[i + 3] = 4;
    await expect(verify(doc)).rejects.toBeInstanceOf(AttestationError);
  });

  it("rejects a broken certificate chain (leaf from another intermediate)", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub, c: { ...chain, leafDer: otherChain.leafDer, leafKey: otherChain.leafKey } });
    await expect(verify(doc)).rejects.toThrow(/certificate 2/);
  });

  it("refuses to run without configured measurements", async () => {
    const doc = await makeDoc({ nonce, publicKey: enclavePub });
    await expect(verify(doc, { expected: { pcr0: "", pcr1: "", pcr2: "" } })).rejects.toThrow(/no expected PCR/);
  });
});

describe("seal", () => {
  it("round-trips with a P-256 key the way the enclave decrypts", async () => {
    const enclave = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const spki = new Uint8Array(await subtle.exportKey("spki", enclave.publicKey));
    const { box, stateKey } = await sealToEnclave(spki, { ufvk: "uviewtest1abc", birthday: 5 });

    // Enclave side, independently: ECDH → HKDF → AES-GCM.
    const epk = await subtle.importKey("raw", unb64(box.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = await subtle.deriveBits({ name: "ECDH", public: epk }, enclave.privateKey, 256);
    const ikm = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const aes = await subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: await subtle.digest("SHA-256", spki), info: new TextEncoder().encode("zeno-instant-sync/v1/register") },
      ikm, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
    );
    const pt = await subtle.decrypt(
      { name: "AES-GCM", iv: unb64(box.iv), additionalData: new TextEncoder().encode("zeno-instant-sync/v1/register") },
      aes, unb64(box.ct),
    );
    const msg = JSON.parse(new TextDecoder().decode(pt));
    expect(msg.ufvk).toBe("uviewtest1abc");
    expect(unb64(msg.stateKey)).toEqual(stateKey);

    // State reply.
    const k = await subtle.importKey("raw", stateKey as BufferSource, "AES-GCM", false, ["encrypt"]);
    const iv = new Uint8Array(12).fill(3);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(STATE_INFO) }, k, new TextEncoder().encode('{"status":"ready"}')));
    const b = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    expect(await openState(stateKey, { iv: b(iv), ct: b(ct) })).toEqual({ status: "ready" });
  });
});
