"use client";

import { PasswordInput } from "@/components/ui/password-input";
import {
  acknowledgeClaim,
  acknowledgeNewWallet,
  beginClaim,
  beginNewWallet,
  cancelNewWallet,
  confirmClaim,
  confirmNewWallet,
  unlockWallet,
  WalletSessionError,
} from "@/features/session/client";
import { markWalletUnlocked } from "@/features/session/store";
import { useWalletSession } from "@/features/session/use-wallet-session";
import { saveVault, vaultMaterial } from "@/features/session/vault";
import {
  confirmationMatches,
  mnemonicWords,
  pickConfirmationIndexes,
} from "@/features/custody/mnemonic";
import { CopySeedButton } from "@/components/wallet/copy-seed-button";
import { useEffect, useState } from "react";

type Step = "home" | "unlock" | "create" | "phrase" | "check" | "claim" | "claim-phrase" | "claim-check";

const fieldClass =
  "h-12 w-full border border-[rgba(244,241,234,0.22)] bg-[#050505] px-4 text-[15px] text-[#f7f4ef] outline-none placeholder:text-[#8c8c8c]";

export function AccountGate({ dense = false }: { dense?: boolean }) {
  const view = useWalletSession();
  const vaults = view.status === "ready" ? view.vaults : [];
  const legacyUnclaimed = view.status === "ready" && view.session.legacyUnclaimed;
  const titleClass = dense
    ? "text-[18px] font-normal tracking-[0.04em] text-[#f7f4ef] uppercase"
    : "text-[28px] font-normal tracking-[0.02em] text-[#f7f4ef] uppercase";
  const stackClass = dense ? "flex flex-col gap-3" : "flex flex-col gap-5";
  const buttonClass = dense
    ? "flex h-11 w-full items-center justify-center border border-[#ffc14a] bg-[#ffc14a] text-[11px] tracking-[0.14em] text-[#140e08] uppercase disabled:opacity-40"
    : "flex h-12 w-full items-center justify-center border border-[#ffc14a] bg-[#ffc14a] text-[12px] tracking-[0.14em] text-[#140e08] uppercase disabled:opacity-40";
  const [step, setStep] = useState<Step>("home");
  const [walletId, setWalletId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [createId, setCreateId] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [checks, setChecks] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => {
      setPhrase("");
    };
  }, []);

  function resetPhrase() {
    setPhrase("");
    setCreateId(null);
    setChecks([]);
    setAnswers({});
  }

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    const selected = walletId ? vaultMaterial(walletId) : null;
    if (!selected) {
      setError("Choose a wallet saved in this browser.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const sessionToken = await unlockWallet({
        password,
        walletId: selected.walletId,
        kdfSalt: selected.kdfSalt,
        ciphertext: selected.ciphertext,
      });
      setPassword("");
      await markWalletUnlocked(selected.walletId, sessionToken);
    } catch (caught) {
      setError(caught instanceof WalletSessionError ? caught.message : "The wallet stayed locked.");
    } finally {
      setPending(false);
    }
  }

  async function startCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const started = await beginNewWallet(password);
      setCreateId(started.createId);
      setPhrase(started.phrase);
      setChecks(pickConfirmationIndexes());
      setAnswers({});
      setStep("phrase");
    } catch (caught) {
      setError(caught instanceof WalletSessionError ? caught.message : "A new seed was not created.");
    } finally {
      setPending(false);
    }
  }

  async function finishCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!createId || !confirmationMatches(phrase, answers)) {
      setError("Those words do not match the new seed.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const vault = await confirmNewWallet(createId);
      await saveVault(vault);
      const sessionToken = await acknowledgeNewWallet(createId);
      resetPhrase();
      setPassword("");
      await markWalletUnlocked(vault.walletId, sessionToken);
    } catch (caught) {
      setError(caught instanceof WalletSessionError ? caught.message : "The new seed was not saved in this browser.");
    } finally {
      setPending(false);
    }
  }

  async function startClaim(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const started = await beginClaim(password);
      setCreateId(started.createId);
      setPhrase(started.phrase);
      setChecks(pickConfirmationIndexes());
      setAnswers({});
      setStep("claim-phrase");
    } catch (caught) {
      setError(caught instanceof WalletSessionError ? caught.message : "The wallet on this computer was not opened.");
    } finally {
      setPending(false);
    }
  }

  async function finishClaim(event: React.FormEvent) {
    event.preventDefault();
    if (!createId || !confirmationMatches(phrase, answers)) {
      setError("Those words do not match the seed.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const vault = await confirmClaim(createId);
      await saveVault(vault);
      const sessionToken = await acknowledgeClaim(createId);
      resetPhrase();
      setPassword("");
      await markWalletUnlocked(vault.walletId, sessionToken);
    } catch (caught) {
      setError(
        caught instanceof WalletSessionError
          ? caught.message
          : "The wallet was not saved in this browser, so the phrase file was kept.",
      );
    } finally {
      setPending(false);
    }
  }

  async function cancelCreate() {
    const id = createId;
    const moving = step === "claim-phrase" || step === "claim-check";
    if (id && !moving) {
      try {
        await cancelNewWallet(id);
      } catch (caught) {
        setError(
          caught instanceof WalletSessionError
            ? caught.message
            : "The new seed is still pending on the wallet service.",
        );
        return;
      }
    }
    resetPhrase();
    setStep("home");
    setError(null);
  }

  if (step === "phrase" || step === "claim-phrase") {
    const words = mnemonicWords(phrase);
    const moving = step === "claim-phrase";
    return (
      <section className={stackClass}>
        <div>
          <h1 className={titleClass}>Write down the seed</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-[#858D89]">
            {moving
              ? "Shown once. After save, the plaintext file on this computer is deleted."
              : "Shown once. Encrypted in this browser only."}
          </p>
        </div>
        <ol className="grid grid-cols-2 gap-1.5">
          {words.map((word, index) => (
            <li
              key={`${word}-${index.toString()}`}
              className="border border-[rgba(244,241,234,0.22)] bg-[#050505] px-2.5 py-1.5 text-[12px] text-[#f7f4ef]"
            >
              <span className="mr-1.5 text-[#858D89]">{index + 1}</span>
              {word}
            </li>
          ))}
        </ol>
        <CopySeedButton phrase={phrase} />
        <button
          type="button"
          data-sound="tap"
          onClick={() => setStep(moving ? "claim-check" : "check")}
          className={buttonClass}
        >
          I wrote it down
        </button>
        <button type="button" data-sound="tap" onClick={() => void cancelCreate()} className="text-sm text-[#858D89]">
          Cancel
        </button>
      </section>
    );
  }

  if (step === "check" || step === "claim-check") {
    const moving = step === "claim-check";
    return (
      <form className={stackClass} onSubmit={(event) => void (moving ? finishClaim(event) : finishCreate(event))}>
        <div>
          <h1 className={titleClass}>Confirm the seed</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-[#858D89]">
            Enter the requested words. The encrypted wallet stays in this browser.
          </p>
        </div>
        {checks.map((index) => (
          <label key={index} className="block text-sm text-[#D0D4D1]">
            Word {index + 1}
            <input
              value={answers[index] ?? ""}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [index]: event.target.value }))
              }
              className={`${fieldClass} mt-2`}
            />
          </label>
        ))}
        {error ? <p className="text-sm text-[#E24B4B]">{error}</p> : null}
        <button
          type="submit"
          data-sound="tap"
          disabled={pending}
          className={buttonClass}
        >
          {pending ? "Saving in this browser" : "Use this seed"}
        </button>
        <button type="button" data-sound="tap" onClick={() => void cancelCreate()} className="text-sm text-[#858D89]">
          Cancel
        </button>
      </form>
    );
  }

  if (step === "create" || step === "claim") {
    const moving = step === "claim";
    return (
      <form className={stackClass} onSubmit={(event) => void (moving ? startClaim(event) : startCreate(event))}>
        <div>
          <h1 className={titleClass}>
            {moving ? "Move this computer's wallet" : "New seed"}
          </h1>
          <p className="mt-2 text-[12px] leading-relaxed text-[#858D89]">
            {moving
              ? "Moves the testnet wallet on this computer into this browser."
              : "Encrypted in this browser. Another browser cannot open it."}
          </p>
        </div>
        <label className="block text-sm text-[#D0D4D1]">
          Password
          <PasswordInput
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            className={`${fieldClass} mt-2`}
          />
        </label>
        {error ? <p className="text-sm text-[#E24B4B]">{error}</p> : null}
        <button
          type="submit"
          data-sound="tap"
          disabled={pending}
          className={buttonClass}
        >
          {pending ? "Preparing the seed" : "Show the seed"}
        </button>
        <button
          type="button"
          data-sound="tap"
          onClick={() => {
            setStep("home");
            setError(null);
          }}
          className="text-sm text-[#858D89]"
        >
          Back
        </button>
      </form>
    );
  }

  if (step === "unlock") {
    return (
      <form className={stackClass} onSubmit={(event) => void unlock(event)}>
        <div>
          <h1 className={titleClass}>Unlock</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-[#858D89]">
            Password opens the encrypted wallet on this computer.
          </p>
        </div>
        <label className="block text-sm text-[#D0D4D1]">
          Password
          <PasswordInput
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            className={`${fieldClass} mt-2`}
          />
        </label>
        {error ? <p className="text-sm text-[#E24B4B]">{error}</p> : null}
        <button
          type="submit"
          data-sound="tap"
          disabled={pending}
          className={buttonClass}
        >
          {pending ? "Unlocking" : "Unlock"}
        </button>
        <button
          type="button"
          data-sound="tap"
          onClick={() => {
            setStep("home");
            setError(null);
          }}
          className="text-sm text-[#858D89]"
        >
          Back
        </button>
      </form>
    );
  }

  return (
    <section className={stackClass}>
      <div>
        <h1 className={titleClass}>This browser</h1>
        <p className="mt-2 text-[12px] leading-relaxed text-[#858D89]">
          Each browser keeps its own wallet.
        </p>
      </div>
      {vaults.map((vault) => (
        <button
          key={vault.walletId}
          type="button"
          data-sound="tap"
          onClick={() => {
            setWalletId(vault.walletId);
            setError(null);
            setStep("unlock");
          }}
          className="border border-[rgba(244,241,234,0.22)] bg-[#050505] px-4 py-3 text-left text-sm text-[#f7f4ef]"
        >
          Wallet {vault.walletId.slice(-4)}
          {vault.birthdayHeight !== null ? (
            <span className="mt-1 block text-[#858D89]">Birthday {vault.birthdayHeight}</span>
          ) : null}
        </button>
      ))}
      {error ? <p className="text-sm text-[#E24B4B]">{error}</p> : null}
      {legacyUnclaimed ? (
        <button
          type="button"
          data-sound="tap"
          onClick={() => {
            setStep("claim");
            setError(null);
          }}
          className={buttonClass}
        >
          Move the wallet on this computer
        </button>
      ) : null}
      <button
        type="button"
        data-sound="tap"
        onClick={() => {
          setStep("create");
          setError(null);
        }}
        className="text-[11px] tracking-[0.14em] text-[#ffc14a] uppercase"
      >
        Create a new seed
      </button>
    </section>
  );
}
