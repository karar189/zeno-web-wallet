/** A small, local LED alphabet. SVG is decorative; the text stays accessible. */
const glyphs: Record<string, string[]> = {
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
};
export function DotMatrix({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={`dot-matrix ${className}`} role="img" aria-label={text}>
      <svg viewBox={`0 0 ${text.length * 6 - 1} 7`} aria-hidden="true">
        {[...text.toUpperCase()].flatMap((letter, index) =>
          (glyphs[letter] ?? []).flatMap((row, y) =>
            [...row].map((dot, x) =>
              dot === "1" ? (
                <circle
                  key={`${index}-${x}-${y}`}
                  cx={index * 6 + x + 0.5}
                  cy={y + 0.5}
                  r={0.36}
                  fill="currentColor"
                />
              ) : null,
            ),
          ),
        )}
      </svg>
    </span>
  );
}

/** Deterministic halftone shield, drawn from points instead of a bitmap. */
export function PrivacyGlyph({ className = "" }: { className?: string }) {
  const dots = [];
  for (let y = 0; y < 47; y++) {
    for (let x = 0; x < 43; x++) {
      const dx = Math.abs(x - 21);
      const inside =
        y < 10 ? dx < 7 + y * 1.35 : y < 27 ? dx < 20 : dx < (47 - y) * 1.03;
      if (!inside) continue;
      const shade = ((x * 17 + y * 13 + x * y * 7) % 11) / 10;
      const edge = dx > (y < 27 ? 16 : (47 - y) * 0.8);
      dots.push(
        <circle
          key={`${x}-${y}`}
          cx={96 + x * 6}
          cy={72 + y * 6}
          r={(edge ? 1.9 : 1 + shade * 1.1).toFixed(2)}
          fill="currentColor"
          opacity={(edge ? 0.9 : 0.2 + shade * 0.65).toFixed(2)}
        />,
      );
    }
  }
  return (
    <svg
      className={`privacy-glyph ${className}`}
      viewBox="0 0 450 450"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="225"
        cy="225"
        r="204"
        stroke="currentColor"
        strokeOpacity=".16"
        strokeDasharray="1 8"
        strokeWidth="2"
      />
      <circle
        cx="225"
        cy="225"
        r="181"
        stroke="currentColor"
        strokeOpacity=".25"
        strokeDasharray="1 5"
      />
      <path
        d="M16 225h24m370 0h24M225 16v24m0 370v24"
        stroke="currentColor"
        strokeOpacity=".5"
      />
      {dots}
      <path
        d="m190 218 25 25 48-55"
        stroke="#101010"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m190 218 25 25 48-55"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
