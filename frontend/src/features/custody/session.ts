let unlockedMnemonic: string | null = null;
const sessionListeners = new Set<() => void>();

function notifySession(): void {
  for (const listener of sessionListeners) {
    listener();
  }
}

export function subscribeSession(onChange: () => void): () => void {
  sessionListeners.add(onChange);
  return () => {
    sessionListeners.delete(onChange);
  };
}

export function unlockSession(mnemonic: string): void {
  unlockedMnemonic = mnemonic;
  notifySession();
}

export function lockSession(): void {
  unlockedMnemonic = null;
  notifySession();
}

export function isSessionUnlocked(): boolean {
  return unlockedMnemonic !== null;
}

export function readSessionMnemonic(): string | null {
  return unlockedMnemonic;
}
