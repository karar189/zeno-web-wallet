"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useState } from "react";
import { parseMnemonic } from "@/features/custody/mnemonic";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/wallet/field-class";
import { playSound } from "@/lib/sound";

type ImportWalletFormProps = {
  onCancel: () => void;
  onSave: (mnemonic: string, password: string) => Promise<void>;
};

export function ImportWalletForm({ onCancel, onSave }: ImportWalletFormProps) {
  const [seed, setSeed] = useState("");
  const [password, setPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish() {
    const parsed = parseMnemonic(seed);
    if (!parsed.ok) {
      setError(parsed.reason);
      playSound("error");
      return;
    }
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      playSound("error");
      return;
    }
    if (password !== confirmedPassword) {
      setError("The passwords do not match.");
      playSound("error");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(parsed.mnemonic, password);
      setSeed("");
      setPassword("");
      setConfirmedPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The wallet could not be saved.");
      playSound("error");
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void finish();
      }}
    >
      <p className="text-muted-foreground text-sm">
        Paste a 24-word seed. It is checked and encrypted on this device. It is not uploaded.
      </p>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Seed</span>
        <textarea
          className={`${fieldClass} h-28 py-2`}
          autoComplete="off"
          spellCheck={false}
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <PasswordInput
          className={fieldClass}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Confirm password</span>
        <PasswordInput
          className={fieldClass}
          autoComplete="new-password"
          value={confirmedPassword}
          onChange={(event) => setConfirmedPassword(event.target.value)}
        />
      </label>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving wallet…" : "Import seed"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
