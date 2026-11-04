import { DotMatrix } from "@/components/brand/dot-matrix";

export function ZenoMark({ className = "" }: { className?: string }) {
  return (
    <span className={`zeno-mark ${className}`}>
      <svg
        className="zeno-mark-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        aria-hidden="true"
      >
        <path d="M12 4 L4 19 L20 19 Z M12 13 L12 4 M12 13 L4 19 M12 13 L20 19" />
        <g fill="currentColor" stroke="none">
          <circle cx="12" cy="4" r="1.9" />
          <circle cx="4" cy="19" r="1.9" />
          <circle cx="20" cy="19" r="1.9" />
          <circle cx="12" cy="13" r="1.9" />
        </g>
      </svg>
      <DotMatrix text="ZENO" />
    </span>
  );
}
