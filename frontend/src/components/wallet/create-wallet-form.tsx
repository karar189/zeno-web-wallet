"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useState } from "react";
import {
  confirmationMatches,
  createMnemonic,
  mnemonicWords,
  pickConfirmationIndexes,
} from "@/features/custody/mnemonic";
import { Button } from "@/components/ui/button";
import { CopySeedButton } from "@/components/wallet/copy-seed-button";
import { fieldClass } from "@/components/wallet/field-class";
import { playSound } from "@/lib/sound";

type CreateWalletFormProps = {
  onCancel: () => void;
  onSave: (mnemonic: string, password: string) => Promise<void>;
};

export function CreateWalletForm({ onCancel, onSave }: CreateWalletFormProps) {
  const [step, setStep] = useState<"password" | "seed" | "confirm">("password");
  const [password, setPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function continueFromPassword() {
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
    const next = createMnemonic();
    setMnemonic(next);
    setPrompts(pickConfirmationIndexes());
    setAnswers({});
    setSaved(false);
    setError(null);
    setStep("seed");
    playSound("step");
  }

  async function finish() {
    if (!mnemonic || !saved) {
      setError("Confirm that you wrote the seed down before continuing.");
      playSound("error");
      return;
    }
    if (!confirmationMatches(mnemonic, answers)) {
      setError("Those words do not match the seed. Check the numbered positions.");
      playSound("error");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(mnemonic, password);
      setPassword("");
      setConfirmedPassword("");
      setMnemonic(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The wallet could not be saved.");
      playSound("error");
      setBusy(false);
    }
  }

  if (step === "password") {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          continueFromPassword();
        }}
      >
        <p className="text-muted-foreground text-sm">
          This password encrypts the seed in this browser. It does not create a server account.
        </p>
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
          <Button type="submit">Continue</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (step === "seed" && mnemonic) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border px-3 py-2 text-sm">
          Write these 24 words down, in order. Anyone with this seed can spend the funds. It is not
          sent to a server. If you leave this page before finishing, the seed is discarded.
        </p>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {mnemonicWords(mnemonic).map((word, index) => (
            <li key={`${index}-${word}`} className="rounded-md border px-2 py-1 font-mono text-sm">
              <span className="text-muted-foreground mr-2">{index + 1}</span>
              {word}
            </li>
          ))}
        </ol>
        <CopySeedButton phrase={mnemonic} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={saved}
            onChange={(event) => {
              setSaved(event.target.checked);
              playSound("tap");
            }}
          />
          I wrote the 24 words down and stored them offline.
        </label>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!saved}
            onClick={() => {
              setError(null);
              setStep("confirm");
            }}
          >
            I saved the seed
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
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
        Enter the requested words to register the backup. The positions start at 1.
      </p>
      {prompts.map((index) => (
        <label key={index} className="block space-y-1">
          <span className="text-sm font-medium">Word {index + 1}</span>
          <input
            className={fieldClass}
            autoComplete="off"
            spellCheck={false}
            value={answers[index] ?? ""}
            onChange={(event) =>
              setAnswers((current) => ({ ...current, [index]: event.target.value }))
            }
          />
        </label>
      ))}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving wallet…" : "Register seed"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("seed")}>
          Back to seed
        </Button>
      </div>
    </form>
  );
}
