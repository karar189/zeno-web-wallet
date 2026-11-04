import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginNewWallet,
  confirmNewWallet,
  getWalletSession,
  lockWallet,
  unlockWallet,
} from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("live wallet session client", () => {
  it("reads only lock flags and never sends a phrase", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ locked: true, hasWallet: true, hasPassword: true, phrase: "abandon art" });
      }),
    );

    const session = await getWalletSession();

    expect(session).toEqual({
      locked: true,
      hasWallet: true,
      hasPassword: true,
      legacyUnclaimed: false,
    });
    expect(calls[0].url).toBe("http://127.0.0.1:8787/api/wallet/session");
    expect(calls[0].init?.cache).toBe("no-store");
    expect(calls[0].init?.credentials).toBe("omit");
    expect(calls[0].init?.body).toBeUndefined();
    expect(JSON.stringify(session)).not.toContain("abandon");
  });

  it("confirms a new seed without repeating the phrase", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const path = String(url);
        if (path.endsWith("/api/wallet/wallets")) {
          return jsonResponse({
            createId: "wallet_test",
            phrase: "legal winner thank year wave sausage worth useful legal winner thank yellow",
            expiresAtMs: 1,
          });
        }
        return jsonResponse({
          walletId: "w_0123456789abcdef0123456789abcdef",
          kdfSalt: "aa",
          ciphertext: "bb",
          birthdayHeight: 2100000,
        });
      }),
    );

    const started = await beginNewWallet("new-password");
    const vault = await confirmNewWallet(started.createId);

    const confirm = calls[1];
    expect(confirm.url).toBe("http://127.0.0.1:8787/api/wallet/wallets/confirm");
    expect(confirm.init?.cache).toBe("no-store");
    expect(String(confirm.init?.body)).not.toContain("legal");
    expect(String(confirm.init?.body)).toContain("wallet_test");
    expect(String(confirm.init?.body)).not.toContain("current-password");
    expect(vault.ciphertext).toBe("bb");
    expect(JSON.stringify(vault)).not.toContain("legal");
  });

  it("locks after a first password and keeps the phrase out of the snapshot", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const path = String(url);
        if (path.endsWith("/api/wallet/session") && init?.method === "GET") {
          return jsonResponse({ locked: false, hasWallet: true, hasPassword: false });
        }
        return jsonResponse({ passwordSet: true, locked: true });
      }),
    );

    const { refreshWalletSession: refresh, logoutLiveWallet: logout, getWalletSessionSnapshot: snapshot } =
      await import("./store");
    await refresh();
    await logout();
    const view = snapshot();
    expect(view).toEqual({
      status: "ready",
      session: { locked: true, hasWallet: false, hasPassword: true, legacyUnclaimed: false },
      vaults: [],
    });
    expect(JSON.stringify(view)).not.toContain("correct-horse");
    expect(JSON.stringify(view)).not.toContain("abandon");
  });

  it("leaves the app usable when the session service is down", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { refreshWalletSession: refresh, getWalletSessionSnapshot: snapshot } = await import("./store");
    await refresh();
    expect(snapshot().status).toBe("unreachable");
  });

  it("lists only the vault saved in this browser", async () => {
    vi.resetModules();
    const { saveVault, listVaultMeta } = await import("./vault");
    await saveVault({
      walletId: "w_0123456789abcdef0123456789abcdef",
      kdfSalt: "aa",
      ciphertext: "bb",
      birthdayHeight: 2100000,
    });
    expect(listVaultMeta()).toEqual([
      {
        walletId: "w_0123456789abcdef0123456789abcdef",
        birthdayHeight: 2100000,
        hasSession: false,
      },
    ]);
    expect(JSON.stringify(listVaultMeta())).not.toContain("abandon");
  });

  it("posts unlock and lock without a recovery phrase", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ""));
        return jsonResponse({ locked: false, sessionToken: "session-token" });
      }),
    );
    await unlockWallet({
      password: "correct-horse",
      walletId: "w_0123456789abcdef0123456789abcdef",
      kdfSalt: "aa",
      ciphertext: "bb",
    });
    await lockWallet();
    expect(bodies[0]).toContain("correct-horse");
    expect(bodies[0]).toContain("ciphertext");
    expect(bodies.join(" ")).not.toContain("abandon");
  });
});
