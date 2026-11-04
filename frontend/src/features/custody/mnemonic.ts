import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const MNEMONIC_WORD_COUNT = 24;
const MNEMONIC_STRENGTH = 256;

export function createMnemonic(): string {
  return generateMnemonic(wordlist, MNEMONIC_STRENGTH);
}

export function mnemonicWords(mnemonic: string): string[] {
  return mnemonic.trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0);
}

export function parseMnemonic(
  input: string,
): { ok: true; mnemonic: string } | { ok: false; reason: string } {
  const words = mnemonicWords(input);
  if (words.length === MNEMONIC_WORD_COUNT + 1) {
    return {
      ok: false,
      reason: "An extra passphrase is not supported. Enter the 24-word seed only.",
    };
  }
  if (words.length !== MNEMONIC_WORD_COUNT) {
    return {
      ok: false,
      reason: `Enter all ${MNEMONIC_WORD_COUNT.toString()} words of the seed.`,
    };
  }

  const mnemonic = words.join(" ");
  if (!validateMnemonic(mnemonic, wordlist)) {
    return {
      ok: false,
      reason: "That seed is not a valid 24-word phrase.",
    };
  }

  return { ok: true, mnemonic };
}

export function pickConfirmationIndexes(
  count = 3,
  wordCount = MNEMONIC_WORD_COUNT,
): number[] {
  const indexes: number[] = [];
  const random = new Uint32Array(1);
  while (indexes.length < count) {
    crypto.getRandomValues(random);
    const index = random[0] % wordCount;
    if (!indexes.includes(index)) {
      indexes.push(index);
    }
  }
  return indexes.sort((left, right) => left - right);
}

export function confirmationMatches(
  mnemonic: string,
  answers: Readonly<Record<number, string>>,
): boolean {
  const words = mnemonicWords(mnemonic);
  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return false;
  }
  return entries.every(([index, answer]) => words[Number(index)] === answer.trim().toLowerCase());
}
