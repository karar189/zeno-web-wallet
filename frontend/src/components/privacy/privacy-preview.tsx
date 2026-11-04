"use client";
import { Eye, LockKeyhole, Network, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  assessRequirements,
  type PrivacyFacts,
  type PrivacyRequirements,
} from "@/features/guard/policy";
import {
  describeTransport,
  type TransportStatus,
} from "@/features/transport/client";

export function PrivacyPreview({
  facts,
  requirements,
  onChange,
  simulated = false,
  sharingAddresses = false,
  transport,
}: {
  facts: PrivacyFacts;
  requirements: PrivacyRequirements;
  onChange: (value: PrivacyRequirements) => void;
  simulated?: boolean;
  /** Live 1Click deposit quotes share destination and refund addresses. */
  sharingAddresses?: boolean;
  /** How the wallet service reaches lightwalletd. Omitted: the generic note is shown. */
  transport?: TransportStatus;
}) {
  const blockers = assessRequirements(facts, requirements);
  const network = describeTransport(transport ?? { kind: "unknown" });
  return (
    <section className="privacy-preview" aria-label="Privacy preview">
      <div className="section-heading">
        <span className="eyebrow">Privacy guard</span>
        <ShieldCheck size={19} />
      </div>
      <h2>Know what becomes visible.</h2>
      <div className="visibility-row">
        <LockKeyhole size={18} />
        <div>
          <strong>
            {facts.receiver === "transparent"
              ? "Public deposit"
              : facts.verified
                ? "Shielded receiver verified"
                : "Receiver not yet verified"}
          </strong>
          <p>
            {facts.receiver === "transparent"
              ? "The Zcash deposit address and amount are public. Shielded source funds do not hide this output."
              : simulated
                ? "This is a simulation. No receiver was decoded and no private transfer occurred."
                : "A shielded output conceals its recipient and amount on chain. Fees, timing, and transaction structure can remain observable."}
          </p>
        </div>
      </div>
      <div className="visibility-row">
        <Eye size={18} />
        <div>
          <strong>
            {facts.provider
              ? "Provider and destination visibility"
              : network.title}
          </strong>
          <p>
            {facts.provider
              ? sharingAddresses
                ? "1Click receives the amount, destination address, and transparent Zcash refund address for a live deposit. The Zcash deposit and the destination-chain payout are public."
                : "1Click receives the amount so it can price the pair. Your addresses are not included until you prepare a deposit. A real swap on the destination chain is public."
              : network.detail}
          </p>
        </div>
      </div>
      {facts.provider && transport && transport.kind !== "unknown" ? (
        <div className="visibility-row">
          <Network size={18} />
          <div>
            <strong>{network.title}</strong>
            <p>{network.detail}</p>
          </div>
        </div>
      ) : null}
      <fieldset className="privacy-options">
        <legend>Your requirements</legend>
        <label>
          <input
            type="checkbox"
            checked={requirements.shieldedOnly}
            onChange={(e) =>
              onChange({ ...requirements, shieldedOnly: e.target.checked })
            }
          />
          <span>Require a verified shielded Zcash receiver</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={requirements.noSwapProvider}
            onChange={(e) =>
              onChange({ ...requirements, noSwapProvider: e.target.checked })
            }
          />
          <span>Avoid external swap providers</span>
        </label>
        {transport && transport.kind !== "unknown" ? (
          <label>
            <input
              type="checkbox"
              checked={Boolean(requirements.mixnetOnly)}
              onChange={(e) =>
                onChange({ ...requirements, mixnetOnly: e.target.checked })
              }
            />
            <span>Require wallet traffic to go through Nym</span>
          </label>
        ) : null}
      </fieldset>
      <div
        className={blockers.length ? "guard-result blocked" : "guard-result"}
        role="status"
      >
        {blockers.length ? (
          <TriangleAlert size={18} />
        ) : (
          <ShieldCheck size={18} />
        )}
        <div>
          <strong>
            {blockers.length
              ? "Does not meet your requirements"
              : "Meets the selected requirements"}
          </strong>
          {blockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
          {!blockers.length && (
            <p>This checks the conditions above, not complete anonymity.</p>
          )}
        </div>
      </div>
    </section>
  );
}
