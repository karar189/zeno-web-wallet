"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTransport, type TransportStatus } from "./client";

/** Current wallet-service transport, refreshed on mount and when the tab regains focus. */
export function useTransport(): {
  transport: TransportStatus;
  refresh: () => Promise<TransportStatus>;
} {
  const [transport, setTransport] = useState<TransportStatus>({ kind: "unknown" });
  const refresh = useCallback(async () => {
    const next = await fetchTransport();
    setTransport(next);
    return next;
  }, []);
  useEffect(() => {
    let live = true;
    const load = () =>
      void fetchTransport().then((next) => {
        if (live) setTransport(next);
      });
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, []);
  return { transport, refresh };
}
