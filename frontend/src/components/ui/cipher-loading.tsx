"use client";

import DecryptedText from "@/components/DecryptedText";

const CHAR_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+#%*+=<>/";

/**
 * React Bits DecryptedText in loop mode — glyphs scramble and resolve
 * until the parent swaps in the real value.
 */
export function CipherLoading({
  label = "Decrypting",
  text,
  length = 10,
  className = "",
}: {
  label?: string;
  /** Placeholder text that keeps decrypting while loading. */
  text?: string;
  length?: number;
  className?: string;
}) {
  const placeholder =
    text ??
    (label.length >= 4 && label.length <= length + 4
      ? label
      : "0".repeat(Math.max(4, length)));

  return (
    <DecryptedText
      text={placeholder}
      animateOn="view"
      effect="scramble"
      sequential
      revealDirection="start"
      speed={40}
      maxIterations={10}
      loop
      loopDelay={480}
      characters={CHAR_POOL}
      scrambleColor="#9a9a9a"
      parentClassName={`cipher-loading ${className}`.trim()}
      className="cipher-loading-glyphs"
      encryptedClassName="cipher-loading-glyphs is-encrypted"
      aria-label={label}
    />
  );
}

/** One-shot decrypt reveal when a loaded value replaces the cipher loop. */
export function CipherReveal({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <DecryptedText
      key={text}
      text={text}
      animateOn="view"
      effect="scramble"
      sequential
      revealDirection="start"
      speed={32}
      maxIterations={8}
      characters={CHAR_POOL}
      scrambleColor="#9a9a9a"
      parentClassName={`cipher-loading ${className}`.trim()}
      className="cipher-loading-glyphs"
      encryptedClassName="cipher-loading-glyphs is-encrypted"
    />
  );
}
