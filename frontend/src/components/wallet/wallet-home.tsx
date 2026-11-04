"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useState } from "react";
import { mnemonicWords } from "@/features/custody/mnemonic";
import { lockSession, readSessionMnemonic } from "@/features/custody/session";
import { clearVault, decryptSeed, type StoredVault, type VaultStorage } from "@/features/custody/vault";
import { Button } from "@/components/ui/button";
import { CopySeedButton } from "@/components/wallet/copy-seed-button";
import { fieldClass } from "@/components/wallet/field-class";
import { playSound } from "@/lib/sound";

type WalletHomeProps = {
  vault: StoredVault;
  storage: VaultStorage;
  onLocked: () => void;
  onDeleted: () => void;
};

export function WalletHome({ vault, storage, onLocked, onDeleted }: WalletHomeProps) {
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState<string[] | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const mnemonic = await decryptSeed(vault, password);
      const session = readSessionMnemonic();
      if (session !== mnemonic) {
        setError("Unlock the wallet again before showing the seed.");
        setRevealed(null);
        playSound("error");
        return;
      }
      setRevealed(mnemonicWords(mnemonic));
      setPassword("");
      playSound("copy");
    } catch (caught) {
      setRevealed(null);
      setError(caught instanceof Error ? caught.message : "The seed could not be shown.");
      playSound("error");
    } finally {
      setBusy(false);
    }
  }

  function removeWallet() {
    if (deleteText !== "DELETE") {
      setError("Type DELETE to remove the wallet from this browser.");
      playSound("error");
      return;
    }
    clearVault(storage);
    lockSession();
    setRevealed(null);
    playSound("lock");
    onDeleted();
  }

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs">Status</dt>
          <dd className="text-sm font-medium">Unlocked on this device</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Saved</dt>
          <dd className="text-sm font-medium">{vault.createdAt}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground text-sm">
        The seed is encrypted in this browser. A Zcash receive address and sending are not available
        yet: the published key library does not return a payment address, and the transaction package
        is not on npm. Nothing on this screen can broadcast a transaction.
      </p>
      <Button
        type="button"
        variant="outline"
        sound="none"
        onClick={() => {
          lockSession();
          setRevealed(null);
          playSound("lock");
          onLocked();
        }}
      >
        Lock wallet
      </Button>

      <form
        className="space-y-3 border-t pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void reveal();
        }}
      >
        <p className="text-sm font-medium">Show seed</p>
        <label className="block space-y-1">
          <span className="text-sm">Password</span>
          <PasswordInput
            className={fieldClass}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? "Checking password…" : "Show seed"}
        </Button>
        {revealed ? (
          <>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {revealed.map((word, index) => (
              <li key={`${index}-${word}`} className="rounded-md border px-2 py-1 font-mono text-sm">
                <span className="text-muted-foreground mr-2">{index + 1}</span>
                {word}
              </li>
            ))}
          </ol>
          <CopySeedButton phrase={revealed.join(" ")} />
          </>
        ) : null}
      </form>

      <form
        className="space-y-3 border-t pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          removeWallet();
        }}
      >
        <p className="text-sm font-medium">Remove wallet from this browser</p>
        <p className="text-muted-foreground text-sm">
          This deletes the encrypted seed stored here. It does not destroy a seed you wrote down.
        </p>
        <label className="block space-y-1">
          <span className="text-sm">Type DELETE</span>
          <input
            className={fieldClass}
            value={deleteText}
            onChange={(event) => setDeleteText(event.target.value)}
          />
        </label>
        <Button type="submit" variant="destructive" sound="none">
          Remove wallet
        </Button>
      </form>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
