"use client";

import { walletServiceUrl } from "@/features/faucet/client";
import { authorizedHeaders } from "@/features/session/vault";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://127.0.0.1:4010";

type Measurement = {
  status: "measured" | "unavailable";
  reason?: string;
  durationMs?: number;
};

type Capabilities = {
  canSubmit: boolean;
  blocker: string;
  network: string;
  proof: Measurement;
  signing: Measurement;
  broadcast: Measurement;
};

type WalletReadiness = {
  network: string;
  sync: string;
  spendableZatoshis: string | null;
  canSubmit: boolean;
  blocker: string;
};

type WalletAddress = {
  address: string | null;
  network: string;
  birthdayHeight: number | null;
  note: string;
};

export function EngineReport() {
  const [report, setReport] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${ENGINE_URL}/capabilities`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("The payment engine did not report capabilities.");
        }
        return response.json() as Promise<Capabilities>;
      })
      .then((body) => {
        if (!cancelled) {
          setReport(body);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("The payment engine is not running. Shielded submission stays unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Payment engine</CardTitle>
          <CardDescription>
            Local Rust process on port 4010. It does not receive a seed, and its report stays
            separate from the simulated lab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {report ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{report.canSubmit ? "Can submit" : "Cannot broadcast"}</Badge>
                <Badge variant="outline">{report.network}</Badge>
              </div>
              <p className="text-sm">{report.blocker}</p>
              <dl className="grid gap-2 sm:grid-cols-3">
                <Stage label="Proof" measurement={report.proof} />
                <Stage label="Signing" measurement={report.signing} />
                <Stage label="Broadcast" measurement={report.broadcast} />
              </dl>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {error ?? "Checking the payment engine…"}
            </p>
          )}
        </CardContent>
      </Card>
      <WalletReport />
    </>
  );
}

function WalletReport() {
  const [report, setReport] = useState<WalletReadiness | null>(null);
  const [address, setAddress] = useState<WalletAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    const headers = await authorizedHeaders();
    const [readinessResponse, addressResponse] = await Promise.all([
      fetch(`${walletServiceUrl()}/api/wallet/readiness`, { headers, cache: "no-store" }),
      fetch(`${walletServiceUrl()}/api/wallet/address`, { headers, cache: "no-store" }),
    ]);
    if (!readinessResponse.ok || !addressResponse.ok) {
      throw new Error("The testnet wallet did not report readiness.");
    }
    return {
      readiness: (await readinessResponse.json()) as WalletReadiness,
      address: (await addressResponse.json()) as WalletAddress,
    };
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .then((body) => {
        if (!cancelled) {
          setReport(body.readiness);
          setAddress(body.address);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("The testnet wallet service is not running. Shielded submission stays unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch(`${walletServiceUrl()}/api/wallet/sync`, {
        method: "POST",
        headers: await authorizedHeaders(),
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Sync did not finish.");
      }
      setReport((await response.json()) as WalletReadiness);
    } catch {
      setError("Sync did not finish. The wallet is still not ready to send.");
    } finally {
      setSyncing(false);
    }
  }

  async function copyAddress() {
    if (!address?.address) {
      return;
    }
    try {
      await navigator.clipboard.writeText(address.address);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Clipboard access failed. Select the receive address and copy it manually.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Local wallet</CardTitle>
        <CardDescription>
          Local process (port 8787 for testnet, 8788 for mainnet). It holds the Zcash wallet on this
          machine and does not accept a seed from the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {report ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{report.network}</Badge>
              <Badge variant="outline">{report.sync}</Badge>
              <Badge variant="outline">{report.canSubmit ? "Can submit" : "Send refused"}</Badge>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">Spendable zatoshis</dt>
                <dd className="text-sm">{report.spendableZatoshis ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Blocker</dt>
                <dd className="text-sm">{report.blocker}</dd>
              </div>
            </dl>
            <div>
              <p className="text-muted-foreground text-xs">Shielded receive address</p>
              <p className="font-mono text-sm break-all">
                {address?.address ?? address?.note ?? "Unavailable"}
              </p>
              {address?.address ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {address.note}
                  {address.birthdayHeight === null
                    ? ""
                    : ` Account birthday height: ${address.birthdayHeight}.`}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {error ?? "Checking the testnet wallet…"}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void sync()} disabled={syncing}>
            {syncing ? "Syncing testnet…" : "Sync testnet"}
          </Button>
          {address?.address ? (
            <Button type="button" variant="outline" sound="none" onClick={() => void copyAddress()}>
              {copied ? "Copied address" : "Copy receive address"}
            </Button>
          ) : null}
        </div>
        {error && report ? <p className="text-muted-foreground text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function Stage({ label, measurement }: { label: string; measurement: Measurement }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">
        {measurement.status === "unavailable" ? "Unavailable" : `${measurement.durationMs ?? "—"} ms`}
      </dd>
    </div>
  );
}
