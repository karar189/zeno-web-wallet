// Minimal CBOR (RFC 8949) codec for Nitro attestation documents (COSE_Sign1).
// Supports what the format uses: unsigned/negative ints, byte/text strings, arrays,
// maps, tags, simple values. Indefinite lengths and floats are rejected on purpose.

export type CborValue =
  | number
  | bigint
  | Uint8Array
  | string
  | CborValue[]
  | Map<CborValue, CborValue>
  | boolean
  | null
  | undefined
  | { tag: number; value: CborValue };

const MAX_DEPTH = 16;

export function decodeCbor(bytes: Uint8Array): CborValue {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const need = (n: number) => {
    if (pos + n > bytes.length) throw new Error("CBOR: truncated input");
  };

  function readLength(info: number): number | bigint {
    if (info < 24) return info;
    if (info === 24) {
      need(1);
      return bytes[pos++];
    }
    if (info === 25) {
      need(2);
      const v = view.getUint16(pos);
      pos += 2;
      return v;
    }
    if (info === 26) {
      need(4);
      const v = view.getUint32(pos);
      pos += 4;
      return v;
    }
    if (info === 27) {
      need(8);
      const v = view.getBigUint64(pos);
      pos += 8;
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    throw new Error("CBOR: indefinite or reserved length not supported");
  }

  function size(info: number): number {
    const n = readLength(info);
    if (typeof n === "bigint" || n > bytes.length) throw new Error("CBOR: length out of range");
    return n;
  }

  function item(depth: number): CborValue {
    if (depth > MAX_DEPTH) throw new Error("CBOR: nesting too deep");
    need(1);
    const initial = bytes[pos++];
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0:
        return readLength(info);
      case 1: {
        const n = readLength(info);
        return typeof n === "bigint" ? BigInt(-1) - n : -1 - n;
      }
      case 2: {
        const n = size(info);
        need(n);
        const out = bytes.slice(pos, pos + n);
        pos += n;
        return out;
      }
      case 3: {
        const n = size(info);
        need(n);
        const out = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(pos, pos + n));
        pos += n;
        return out;
      }
      case 4: {
        const n = size(info);
        const out: CborValue[] = [];
        for (let i = 0; i < n; i++) out.push(item(depth + 1));
        return out;
      }
      case 5: {
        const n = size(info);
        const out = new Map<CborValue, CborValue>();
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          out.set(k, item(depth + 1));
        }
        return out;
      }
      case 6: {
        const tag = readLength(info);
        if (typeof tag === "bigint") throw new Error("CBOR: tag out of range");
        return { tag, value: item(depth + 1) };
      }
      default:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error("CBOR: floats and other simple values are not supported");
    }
  }

  const value = item(0);
  if (pos !== bytes.length) throw new Error("CBOR: trailing bytes");
  return value;
}

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  if (n <= 0xffffffff) return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  if (Number.isSafeInteger(n)) {
    const b = new Uint8Array(9);
    b[0] = (major << 5) | 27;
    new DataView(b.buffer).setBigUint64(1, BigInt(n));
    return Array.from(b);
  }
  throw new Error("CBOR: length too large");
}

/** Encoder for the few shapes COSE needs (Sig_structure, test fixtures). */
export function encodeCbor(value: CborValue): Uint8Array {
  const out: number[] = [];
  const push = (bytes: ArrayLike<number>) => {
    for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
  };
  function enc(v: CborValue) {
    if (v instanceof Uint8Array) {
      push(head(2, v.length));
      push(v);
    } else if (typeof v === "string") {
      const b = new TextEncoder().encode(v);
      push(head(3, b.length));
      push(b);
    } else if (typeof v === "number") {
      if (!Number.isSafeInteger(v)) throw new Error("CBOR: only integers are supported");
      if (v >= 0) push(head(0, v));
      else push(head(1, -1 - v));
    } else if (Array.isArray(v)) {
      push(head(4, v.length));
      v.forEach(enc);
    } else if (v instanceof Map) {
      push(head(5, v.size));
      for (const [k, val] of v) {
        enc(k);
        enc(val);
      }
    } else if (v === null) {
      out.push(0xf6);
    } else if (v === true || v === false) {
      out.push(v ? 0xf5 : 0xf4);
    } else if (typeof v === "object" && v && "tag" in v) {
      push(head(6, v.tag));
      enc(v.value);
    } else {
      throw new Error("CBOR: unsupported value");
    }
  }
  enc(value);
  return Uint8Array.from(out);
}
