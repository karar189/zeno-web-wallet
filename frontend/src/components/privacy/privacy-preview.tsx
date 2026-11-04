"use client";
import { Eye, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  assessRequirements,
  type PrivacyFacts,
  type PrivacyRequirements,
} from "@/features/guard/policy";

export function PrivacyPreview({
  facts,
  requirements,
  onChange,
  simulated = false,
  sharingAddresses = false,
}: {
  facts: PrivacyFacts;
  requirements: PrivacyRequirements;
  onChange: (value: PrivacyRequirements) => void;
  simulated?: boolean;
  /** Live 1Click deposit quotes share destination and refund addresses. */
  sharingAddresses?: boolean;
}) {
  const blockers = assessRequirements(facts, requirements);
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
              : "Local wallet and network visibility"}
          </strong>
          <p>
            {facts.provider
              ? sharingAddresses
                ? "1Click receives the amount, destination address, and transparent Zcash refund address for a live deposit. The Zcash deposit and the destination-chain payout are public."
                : "1Click receives the amount so it can price the pair. Your addresses are not included until you prepare a deposit. A real swap on the destination chain is public."
              : "The local wallet service processes payment details and signs. The lightwallet server can observe connection metadata. Shielding is not network anonymity."}
          </p>
        </div>
      </div>
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
