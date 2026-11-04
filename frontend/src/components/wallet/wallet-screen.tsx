"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useMemo, useState, useSyncExternalStore } from "react";
import { isSessionUnlocked, subscribeSession, unlockSession } from "@/features/custody/session";
import {
  browserVaultStorage,
  decryptSeed,
  encryptSeed,
  readVault,
  readVaultRaw,
  subscribeVault,
  writeVault,
  type StoredVault,
} from "@/features/custody/vault";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateWalletForm } from "@/components/wallet/create-wallet-form";
import { fieldClass } from "@/components/wallet/field-class";
import { ImportWalletForm } from "@/components/wallet/import-wallet-form";
import { WalletHome } from "@/components/wallet/wallet-home";
import { playSound } from "@/lib/sound";

type Mode = "choose" | "create" | "import" | "unlock" | "home";

function loadVault(raw: string | null): { vault: StoredVault | null; error: string | null } {
  if (raw === null || raw.length === 0) {
    return { vault: null, error: null };
  }
  try {
    return {
      vault: readVault({
        get: () => raw,
        set: () => undefined,
        remove: () => undefined,
      }),
      error: null,
    };
  } catch (caught) {
    return {
      vault: null,
      error: caught instanceof Error ? caught.message : "The saved wallet could not be opened.",
    };
  }
}

export function WalletScreen() {
  const storage = useMemo(() => browserVaultStorage(), []);
  const raw = useSyncExternalStore(subscribeVault, readVaultRaw, () => null);
  const unlocked = useSyncExternalStore(subscribeSession, isSessionUnlocked, () => false);
  const loaded = useMemo(() => loadVault(raw), [raw]);
  const [flow, setFlow] = useState<"choose" | "create" | "import">("choose");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vault = loaded.vault;
  const mode: Mode = vault ? (unlocked ? "home" : "unlock") : flow;

  async function save(mnemonic: string, nextPassword: string) {
    if (readVault(storage)) {
      throw new Error("A wallet is already saved in this browser. Remove it before creating another.");
    }
    const next = await encryptSeed(mnemonic, nextPassword);
    writeVault(storage, next);
    unlockSession(mnemonic);
    setError(null);
    playSound("success");
  }

  async function unlock() {
    if (!vault) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const mnemonic = await decryptSeed(vault, password);
      unlockSession(mnemonic);
      setPassword("");
      playSound("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The wallet could not be unlocked.");
      playSound("error");
    } finally {
      setBusy(false);
    }
  }

  const message = error ?? loaded.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === "home"
            ? "Wallet"
            : mode === "create"
              ? "Create wallet"
              : mode === "import"
                ? "Import seed"
                : mode === "unlock"
                  ? "Unlock wallet"
                  : "Wallet signup"}
        </CardTitle>
        <CardDescription>
          Signup stays on this device. The seed is encrypted in the browser and is never registered
          on a server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mode === "choose" ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Create a new 24-word seed, or import one you already have. You will choose a password
              that unlocks it on this browser.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setFlow("create")}>
                Create wallet
              </Button>
              <Button type="button" variant="outline" onClick={() => setFlow("import")}>
                Import seed
              </Button>
            </div>
          </div>
        ) : null}

        {mode === "create" ? (
          <CreateWalletForm onCancel={() => setFlow("choose")} onSave={save} />
        ) : null}
        {mode === "import" ? (
          <ImportWalletForm onCancel={() => setFlow("choose")} onSave={save} />
        ) : null}

        {mode === "unlock" && vault ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <p className="text-muted-foreground text-sm">
              A wallet is already saved in this browser. Enter its password to unlock it for this
              visit. Refreshing the page locks it again.
            </p>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Password</span>
              <PasswordInput
                className={fieldClass}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button type="submit" sound="none" disabled={busy}>
              {busy ? "Unlocking…" : "Unlock"}
            </Button>
          </form>
        ) : null}

        {mode === "home" && vault ? (
          <WalletHome
            vault={vault}
            storage={storage}
            onLocked={() => setPassword("")}
            onDeleted={() => setFlow("choose")}
          />
        ) : null}
        {message ? <p className="text-destructive mt-4 text-sm">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
