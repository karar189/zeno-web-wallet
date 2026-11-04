import { describe, expect, it } from "vitest";
import { auditCsv, auditCsvFileName, coinAmount, type AuditTransaction } from "./audit-csv";

const received: AuditTransaction = {
  txid: "4d3578160554519dd0441c6b229043253f784f720b78e1d35793df7a7083486c",
  minedHeight: 4541719,
  blockTime: 1792968915,
  kind: "received",
  netZatoshis: "100000000",
  receivedZatoshis: "100000000",
  spentZatoshis: "0",
  feeZatoshis: "15000",
  pools: ["ironwood"],
  recipients: [],
  memos: ["fauzec/v1\n01M5TMCPMJG1D31Z135W2Y77P3"],
  fullDetails: true,
};

describe("viewing-key CSV export", () => {
  it("formats exact fixed-point amounts", () => {
    expect(coinAmount("100000000")).toBe("1.00000000");
    expect(coinAmount("-20015000")).toBe("-0.20015000");
    expect(coinAmount("1")).toBe("0.00000001");
    expect(coinAmount("0")).toBe("0.00000000");
    expect(coinAmount("2100000000000000")).toBe("21000000.00000000");
    expect(() => coinAmount("1.5")).toThrow();
  });

  it("writes a header and one CRLF row per transaction", () => {
    const csv = auditCsv([received], { unit: "TAZ" });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Date (UTC),Block height,Transaction ID,Type,Amount (TAZ),Received (TAZ),Spent (TAZ),Fee (TAZ),Pools,Recipients,Memo,Details",
    );
    expect(lines[1]).toBe(
      `2026-10-25T22:55:15Z,4541719,${received.txid},Received,1.00000000,1.00000000,0.00000000,0.00015000,ironwood,,"fauzec/v1\n01M5TMCPMJG1D31Z135W2Y77P3",Full`,
    );
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes separators and neutralizes spreadsheet formulas from memos", () => {
    const hostile: AuditTransaction = {
      ...received,
      kind: "sent",
      netZatoshis: "-20015000",
      feeZatoshis: null,
      blockTime: null,
      minedHeight: null,
      recipients: [{ address: "utest1abc", zatoshis: "20000000" }],
      memos: ['=HYPERLINK("http://evil","x")', "a,b"],
      fullDetails: false,
    };
    const row = auditCsv([hostile], { unit: "ZEC" }).split("\r\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""http://evil"",""x"") | a,b"`);
    expect(row).toContain(",Sent,-0.20015000,");
    expect(row).toContain("utest1abc (0.20000000)");
    expect(row.startsWith(",,")).toBe(true);
    expect(row.endsWith('"Compact only: memo, fee and recipients may be missing"')).toBe(true);
  });

  it("names the file after network and height", () => {
    expect(auditCsvFileName("testnet", 4582571)).toBe(
      "zeno-viewing-key-report-testnet-4582571.csv",
    );
  });
});
