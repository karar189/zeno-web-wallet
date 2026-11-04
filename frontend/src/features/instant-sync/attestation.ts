// Verifies an AWS Nitro Enclaves attestation document in the browser.
//
// The document is a COSE_Sign1 (CBOR) structure signed with ECDSA P-384 by a per-enclave
// leaf certificate that chains to the AWS Nitro root CA. We check, in order:
//   1. COSE structure and algorithm (ES384), payload fields and types
//   2. cabundle[0] is the pinned AWS root (by SHA-256 of its DER)
//   3. every certificate in root → … → leaf is signed by its parent, is valid at the
//      document's timestamp, and every issuer is a CA
//   4. the COSE signature over Sig_structure with the leaf key
//   5. the nonce we sent, the document's freshness
//   6. PCR0/1/2 equal the measurements published by the reproducible build (never all-zero,
//      which is what a debug-mode enclave reports)
// Only then is the enclave's public key returned. Anything else throws.
// Reference: https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html

import { BasicConstraintsExtension, X509Certificate } from "@peculiar/x509";

import { decodeCbor, encodeCbor, type CborValue } from "./cbor";

/** SHA-256 of the DER of AWS_NitroEnclaves_Root-G1 (CN=aws.nitro-enclaves), as published by AWS. */
export const AWS_NITRO_ROOT_SHA256 = "641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b";

export type Measurements = { pcr0: string; pcr1: string; pcr2: string };

export type VerifiedAttestation = {
  /** The enclave's public key (SPKI DER), bound into the signed document. */
  publicKey: Uint8Array;
  pcrs: Measurements;
  moduleId: string;
  timestamp: number;
};

export type VerifyOptions = {
  expected: Measurements;
  nonce: Uint8Array;
  /** Defaults to Date.now(). */
  now?: number;
  /** Max age of the document. Default 5 minutes. */
  maxAgeMs?: number;
  /** Test hook only. Production always uses the AWS root. */
  rootSha256?: string;
};

const ES384 = -35;
const HEX_PCR = /^[0-9a-f]{96}$/;

export class AttestationError extends Error {
  constructor(message: string) {
    super(`Enclave attestation failed: ${message}`);
    this.name = "AttestationError";
  }
}

const fail = (message: string): never => {
  throw new AttestationError(message);
};

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function asBytes(v: CborValue | undefined, name: string): Uint8Array {
  return v instanceof Uint8Array ? v : fail(`${name} is not a byte string`);
}

const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

export function measurementsConfigured(m: Partial<Measurements> | null | undefined): m is Measurements {
  return Boolean(m && HEX_PCR.test(m.pcr0 ?? "") && HEX_PCR.test(m.pcr1 ?? "") && HEX_PCR.test(m.pcr2 ?? ""));
}

export async function verifyAttestation(document: Uint8Array, opts: VerifyOptions): Promise<VerifiedAttestation> {
  if (!measurementsConfigured(opts.expected)) fail("no expected PCR measurements are configured");
  const subtle = globalThis.crypto.subtle;

  // 1. COSE_Sign1 = [protected: bstr, unprotected: map, payload: bstr, signature: bstr], optionally tag 18.
  let outer: CborValue;
  try {
    outer = decodeCbor(document);
  } catch (error) {
    return fail(`document is not valid CBOR (${(error as Error).message})`);
  }
  if (outer && typeof outer === "object" && "tag" in outer) {
    if (outer.tag !== 18) fail("unexpected COSE tag");
    outer = outer.value;
  }
  if (!Array.isArray(outer) || outer.length !== 4) fail("document is not a COSE_Sign1 array");
  const [protectedBytes, , payloadBytes, signature] = outer as CborValue[];
  const prot = decodeCbor(asBytes(protectedBytes, "protected header"));
  if (!(prot instanceof Map) || prot.get(1) !== ES384) fail("signature algorithm is not ES384");
  const payload = decodeCbor(asBytes(payloadBytes, "payload"));
  if (!(payload instanceof Map)) fail("payload is not a map");
  const doc = payload as Map<CborValue, CborValue>;
  const sig = asBytes(signature, "signature");
  if (sig.length !== 96) fail("signature has the wrong length");

  const moduleId = doc.get("module_id");
  if (typeof moduleId !== "string" || !moduleId) fail("missing module_id");
  if (doc.get("digest") !== "SHA384") fail("digest is not SHA384");
  const timestamp = doc.get("timestamp");
  if (typeof timestamp !== "number") fail("missing timestamp");
  const leafDer = asBytes(doc.get("certificate"), "certificate");
  const cabundle = doc.get("cabundle");
  if (!Array.isArray(cabundle) || cabundle.length === 0) fail("missing cabundle");
  const pcrMap = doc.get("pcrs");
  if (!(pcrMap instanceof Map)) fail("missing pcrs");

  // 2. Pinned root.
  const chainDer = (cabundle as CborValue[]).map((c, i) => asBytes(c, `cabundle[${i}]`));
  const rootHash = toHex(new Uint8Array(await subtle.digest("SHA-256", buf(chainDer[0]))));
  if (rootHash !== (opts.rootSha256 ?? AWS_NITRO_ROOT_SHA256)) fail("certificate chain does not start at the AWS Nitro root");

  // 3. Chain root → intermediates → leaf, checked at the document's own timestamp.
  const at = new Date(timestamp as number);
  const certs = [...chainDer, leafDer].map((der) => {
    try {
      return new X509Certificate(buf(der));
    } catch {
      return fail("certificate could not be parsed");
    }
  });
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    const issuer = certs[i === 0 ? 0 : i - 1];
    if (!(await cert.verify({ publicKey: issuer, date: at }))) {
      fail(`certificate ${i} is not validly signed or not valid at the document time`);
    }
    if (i < certs.length - 1) {
      const bc = cert.getExtension(BasicConstraintsExtension);
      if (!bc?.ca) fail(`certificate ${i} is not a CA but issued another certificate`);
    }
  }

  // 4. COSE signature: Sig_structure = ["Signature1", protected, external_aad = h'', payload].
  const toBeSigned = encodeCbor(["Signature1", protectedBytes as Uint8Array, new Uint8Array(0), payloadBytes as Uint8Array]);
  const leafKey = await certs[certs.length - 1].publicKey.export({ name: "ECDSA", namedCurve: "P-384" }, ["verify"]);
  const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-384" }, leafKey, buf(sig), buf(toBeSigned));
  if (!ok) fail("COSE signature does not verify");

  // 5. Freshness: our nonce, recent timestamp.
  const nonce = doc.get("nonce");
  if (!(nonce instanceof Uint8Array) || !bytesEqual(nonce, opts.nonce)) fail("nonce does not match the request");
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeMs ?? 5 * 60_000;
  if ((timestamp as number) > now + 60_000 || now - (timestamp as number) > maxAge) fail("document is stale");

  // 6. Measurements.
  const pcr = (i: number) => {
    const v = (pcrMap as Map<CborValue, CborValue>).get(i);
    const b = asBytes(v, `PCR${i}`);
    if (b.length !== 48) fail(`PCR${i} has the wrong length`);
    if (b.every((x) => x === 0)) fail(`PCR${i} is all zeros (debug-mode enclave)`);
    return toHex(b);
  };
  const pcrs = { pcr0: pcr(0), pcr1: pcr(1), pcr2: pcr(2) };
  for (const k of ["pcr0", "pcr1", "pcr2"] as const) {
    if (pcrs[k] !== opts.expected[k].toLowerCase()) {
      fail(`${k.toUpperCase()} ${pcrs[k].slice(0, 16)}… does not match the published build`);
    }
  }

  const publicKey = asBytes(doc.get("public_key"), "public_key");
  return { publicKey, pcrs, moduleId: moduleId as string, timestamp: timestamp as number };
}
