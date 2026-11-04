import { describe, expect, it } from "vitest";
import {
  confirmationMatches,
  createMnemonic,
  mnemonicWords,
  parseMnemonic,
  pickConfirmationIndexes,
} from "@/features/custody/mnemonic";
import { lockSession, unlockSession, isSessionUnlocked, readSessionMnemonic } from "@/features/custody/session";
import {
  decryptSeed,
  encryptSeed,
  memoryVaultStorage,
  readVault,
  writeVault,
} from "@/features/custody/vault";

describe("mnemonic", () => {
  it("creates a 24-word seed and rejects a changed phrase", () => {
    const mnemonic = createMnemonic();
    expect(mnemonicWords(mnemonic)).toHaveLength(24);
    expect(parseMnemonic(mnemonic).ok).toBe(true);

    const words = mnemonicWords(mnemonic);
    words[0] = words[0] === "abandon" ? "ability" : "abandon";
    expect(parseMnemonic(words.join(" ")).ok).toBe(false);
    expect(parseMnemonic(words.slice(0, 23).join(" ")).ok).toBe(false);
    expect(parseMnemonic(`${mnemonic} extra`).ok).toBe(false);
  });

  it("checks the requested seed words", () => {
    const mnemonic = createMnemonic();
    const indexes = pickConfirmationIndexes();
    expect(new Set(indexes).size).toBe(3);
    const words = mnemonicWords(mnemonic);
    const answers = Object.fromEntries(indexes.map((index) => [index, words[index]]));
    expect(confirmationMatches(mnemonic, answers)).toBe(true);
    expect(confirmationMatches(mnemonic, { ...answers, [indexes[0]]: "notaword" })).toBe(false);
  });
});

describe("vault", () => {
  it("stores ciphertext that does not contain the seed and unlocks only with the password", async () => {
    const mnemonic = createMnemonic();
    const storage = memoryVaultStorage();
    const vault = await encryptSeed(mnemonic, "correct-horse", { iterations: 1_000 });
    writeVault(storage, vault);

    const saved = storage.get() ?? "";
    for (const word of mnemonicWords(mnemonic)) {
      expect(saved.includes(word)).toBe(false);
    }

    const loaded = readVault(storage);
    expect(loaded?.kdf).toBe("PBKDF2-SHA-256");
    await expect(decryptSeed(loaded!, "wrong-password")).rejects.toThrow(/did not unlock/);
    await expect(decryptSeed(loaded!, "correct-horse")).resolves.toBe(mnemonic);
  });
});

describe("session", () => {
  it("keeps the seed in memory only until lock", () => {
    lockSession();
    expect(isSessionUnlocked()).toBe(false);
    unlockSession("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    expect(readSessionMnemonic()).toContain("abandon");
    lockSession();
    expect(readSessionMnemonic()).toBeNull();
  });
});
