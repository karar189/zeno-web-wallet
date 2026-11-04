import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDisclosureAccount,
  exportDisclosureKey,
  getDisclosureStatus,
  requestDisclosureExport,
} from "./client";
import {
  DISCLOSURE_IRREVERSIBLE_WARNING,
  DISCLOSURE_PRIMARY_WARNING,
  DISCLOSURE_SCOPE_WARNING,
  DISCLOSURE_SENDER_WARNING,
  DISCLOSURE_SERVICE_SPEND_WARNING,
} from "./copy";
import type { DisclosureStatus, TransactionDisclosureCapability } from "./types";

const CAPABILITY: TransactionDisclosureCapability = {
  implemented: false,
  saplingZip311: false,
  orchard: false,
  reason:
    "The pinned zcash crates do not implement ZIP 311 payment disclosures.",
};

function makeStatus(overrides: Partial<DisclosureStatus> = {}): DisclosureStatus {
  return {
    created: true,
    network: "testnet",
    accountIndex: 1,
    address: `utest1${"a".repeat(80)}`,
    birthdayHeight: 2_000_001,
    detectedZatoshis: "0",
    spendableZatoshis: "0",
    sync: "synced",
    note: "Dedicated disclosure account.",
    transactionDisclosure: CAPABILITY,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("disclosure client", () => {
  it("reads status with a non-cacheable request and no key", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse(makeStatus());
      }),
    );

    const status = await getDisclosureStatus();

    expect(status.accountIndex).toBe(1);
    expect(status.transactionDisclosure.orchard).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "http://127.0.0.1:8787/api/wallet/disclosure",
    );
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.cache).toBe("no-store");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("sends explicit approval for creation and export requests", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/export/request")) {
          return jsonResponse({
            exportId: "export_123",
            expiresAtMs: 1_800_000_120_000,
            network: "testnet",
            accountIndex: 1,
            note: "No key released.",
            transactionDisclosure: CAPABILITY,
          });
        }
        if (String(url).endsWith("/export")) {
          return jsonResponse({
            exportId: "export_123",
            network: "testnet",
            accountIndex: 1,
            ufvk: `uviewtest1${"b".repeat(80)}`,
            uivk: `uivktest1${"c".repeat(80)}`,
            scope: {
              account: "dedicated disclosure account",
              incoming: ["amount"],
              outgoing: ["recipient address"],
              canSpend: false,
              seesPrimaryAccount: false,
              provesSenderIdentity: false,
            },
            warning: "Bearer capability.",
            transactionDisclosure: CAPABILITY,
          });
        }
        return jsonResponse(makeStatus());
      }),
    );

    await createDisclosureAccount();
    await requestDisclosureExport();
    await exportDisclosureKey("export_123");

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:8787/api/wallet/disclosure/account",
      "http://127.0.0.1:8787/api/wallet/disclosure/export/request",
      "http://127.0.0.1:8787/api/wallet/disclosure/export",
    ]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      approved: true,
    });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      approved: true,
    });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      exportId: "export_123",
      approved: true,
    });
    for (const call of calls) {
      expect(call.init?.cache).toBe("no-store");
      expect(call.init?.credentials).toBe("omit");
      expect(call.init?.referrerPolicy).toBe("no-referrer");
    }
  });

  it("does not write keys or status to browser storage", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      setItem,
      getItem: () => null,
      removeItem: () => undefined,
      clear: () => undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(makeStatus())),
    );

    await getDisclosureStatus();

    expect(setItem).not.toHaveBeenCalled();
  });

  it("surfaces the wallet service refusal without inventing a key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { message: "Explicit approval is required before creating or exporting a disclosure account key." },
          403,
        ),
      ),
    );

    await expect(requestDisclosureExport()).rejects.toThrow(
      "Explicit approval is required",
    );
  });
});

describe("disclosure warnings", () => {
  it("explains scope, spending limits, primary-account isolation, and irreversibility", () => {
    const copy = [
      DISCLOSURE_SCOPE_WARNING,
      DISCLOSURE_IRREVERSIBLE_WARNING,
      DISCLOSURE_PRIMARY_WARNING,
      DISCLOSURE_SENDER_WARNING,
      DISCLOSURE_SERVICE_SPEND_WARNING,
    ].join(" ");

    expect(copy).toMatch(/transaction ids/i);
    expect(copy).toMatch(/recipient addresses/i);
    expect(copy).toMatch(/memos/i);
    expect(copy).toMatch(/cannot sign or spend/i);
    expect(copy).toMatch(/primary account/i);
    expect(copy).toMatch(/cannot be reliably revoked/i);
    expect(copy).toMatch(/does not prove who sent/i);
    expect(copy).toMatch(/service still holds the seed/i);
  });
});
