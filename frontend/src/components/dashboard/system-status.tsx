import { getApiBaseUrl } from "@/lib/api-client";

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-cream/10 bg-ink px-3.5 py-3">
      <span className="size-1.5 shrink-0 rounded-full bg-brass" aria-hidden="true" />
      <dt className="w-14 shrink-0 text-[10px] tracking-[0.18em] text-cream/55 uppercase">
        {label}
      </dt>
      <dd className="truncate font-mono text-[11px] text-cream/80">{value}</dd>
    </div>
  );
}

export function SystemStatus() {
  const apiBase = `${getApiBaseUrl()}/api`;

  return (
    <section className="glass mt-3 rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="desk-kicker">Local services</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-cream sm:text-2xl">
            Development endpoints
          </h2>
        </div>
        <span className="rounded-full border border-cream/12 bg-ink px-3 py-1 text-[9px] tracking-[0.18em] text-cream/55 uppercase">
          Scaffold
        </span>
      </div>

      <dl className="mt-5 grid gap-2.5 sm:grid-cols-2">
        <StatusRow label="API" value={apiBase} />
      </dl>

      <p className="mt-4 text-sm leading-relaxed text-cream/65">
        Endpoints are local to this machine. Live and mock data stay labelled
        wherever they appear.
      </p>
    </section>
  );
}
