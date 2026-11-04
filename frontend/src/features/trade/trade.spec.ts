import { describe, expect, it, vi } from "vitest";
import { parseUnits, selectListedToken } from "@/features/trade/catalog";
import { fetchDepositQuote, fetchTradeQuote, validateDeposit, validateTrade } from "@/features/trade/quote";
import { fetchSwapStatus, submitDepositHash } from "@/features/trade/status";
import { POST } from "@/app/api/trade/quote/route";
import { POST as depositPost } from "@/app/api/trade/deposit/route";
import { POST as notifyPost } from "@/app/api/trade/notify/route";

const tokens = [
  {
    assetId: "1cs_v1:sol:spl:not-this-zec",
    blockchain: "sol",
    symbol: "ZEC",
    decimals: 8,
    price: 1,
  },
  {
    assetId: "nep141:zec.omft.near",
    blockchain: "zec",
    symbol: "ZEC",
    decimals: 8,
    price: 400,
  },
  {
    assetId: "nep141:sol-usdc.omft.near",
    blockchain: "sol",
    symbol: "USDC",
    decimals: 6,
    price: 1,
  },
];

const input = {
  amount: "0.1",
  payBlockchain: "zec",
  paySymbol: "ZEC",
  receiveBlockchain: "sol",
  receiveSymbol: "USDC",
  consent: true,
};

describe("token trading", () => {
  it("uses native ZEC and rejects an unlisted pair", () => {
    expect(selectListedToken(tokens, "zec", "ZEC").assetId).toBe(
      "nep141:zec.omft.near",
    );
    expect(() => selectListedToken(tokens, "near", "USDC")).toThrow(
      "not available",
    );
  });

  it("parses token units without floats", () => {
    expect(parseUnits("0.1", 8).ok && parseUnits("0.1", 8)).toMatchObject({
      units: 10000000n,
    });
    expect(parseUnits("1e2", 6).ok).toBe(false);
    expect(parseUnits("0.000000001", 8).ok).toBe(false);
  });

  it("requires ZEC on one side and explicit consent", () => {
    expect(() =>
      validateTrade({
        ...input,
        paySymbol: "USDC",
        payBlockchain: "sol",
        receiveSymbol: "ETH",
        receiveBlockchain: "eth",
      }),
    ).toThrow("ZEC");
    expect(() => validateTrade({ ...input, consent: false })).toThrow(
      "Approve",
    );
  });

  it("requests a dry quote and hides deposit details", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(
        Response.json({
          quote: {
            amountIn: "10000000",
            amountOut: "12345678",
            minAmountOut: "12222222",
            depositAddress: "must-not-escape",
            timeEstimate: 90,
          },
        }),
      );
    const result = await fetchTradeQuote(input, fetcher);
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body).toMatchObject({
      dry: true,
      amount: "10000000",
      originAsset: "nep141:zec.omft.near",
      destinationAsset: "nep141:sol-usdc.omft.near",
    });
    expect(body.recipient).not.toContain("must-not-escape");
    expect(result.receiveAmount).toBe("12.345678");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(JSON.stringify(result)).not.toContain(body.recipient);
    expect(JSON.stringify(result)).not.toContain(body.refundTo);
  });

  it("rejects a trade quote from another site", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/trade/quote", {
        method: "POST",
        headers: {
          origin: "https://other.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("builds a live deposit quote only from the supplied addresses", async () => {
    const refundTo = `t1${"1".repeat(26)}`;
    const recipient = "4iBR7RCMPRFpGF6vqKejc6e9gGLAxhuFhXPLXu7o7VfG";
    const depositAddress = `t3${"2".repeat(26)}`;
    const deadline = "2026-11-04T10:30:00.000Z";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(
        Response.json({
          quoteRequest: { refundTo, recipient, amount: "10000000" },
          quote: {
            amountIn: "10000000",
            amountOut: "12345678",
            minAmountOut: "12222222",
            depositAddress,
            refundTo,
            recipient,
            deadline,
            timeEstimate: 452,
          },
        }),
      );
    const result = await fetchDepositQuote(
      { ...input, recipient, refundTo },
      fetcher,
    );
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.dry).toBe(false);
    expect(Date.parse(body.deadline) - Date.now()).toBeGreaterThan(20 * 60 * 1000);
    expect(body.refundTo).toBe(refundTo);
    expect(body.recipient).toBe(recipient);
    expect(result.depositAddress).toBe(depositAddress);
    expect(result.amountIn).toBe("10000000");
    expect(result.deadline).toBe(deadline);
    expect(result.estimatedSeconds).toBe(452);
    expect(() =>
      validateDeposit({ ...input, recipient: "not-an-address", refundTo }),
    ).toThrow("Solana");
    const rejected = await depositPost(
      new Request("http://localhost:3000/api/trade/deposit", {
        method: "POST",
        headers: {
          origin: "https://other.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...input, recipient, refundTo }),
      }),
    );
    expect(rejected.status).toBe(403);
  });

  it("reads swap status and notifies 1Click of the deposit hash", async () => {
    const depositAddress = `t3${"2".repeat(26)}`;
    const txHash = "a".repeat(64);
    const statusFetcher = vi.fn().mockResolvedValueOnce(
      Response.json({ status: "PENDING_DEPOSIT" }),
    );
    const status = await fetchSwapStatus(depositAddress, statusFetcher);
    expect(status.status).toBe("PENDING_DEPOSIT");
    expect(statusFetcher.mock.calls[0][0]).toContain(
      encodeURIComponent(depositAddress),
    );

    const notifyFetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await submitDepositHash({ depositAddress, txHash }, notifyFetcher);
    expect(JSON.parse(notifyFetcher.mock.calls[0][1].body)).toEqual({
      depositAddress,
      txHash,
    });

    const rejected = await notifyPost(
      new Request("http://localhost:3000/api/trade/notify", {
        method: "POST",
        headers: {
          origin: "https://other.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ depositAddress, txHash }),
      }),
    );
    expect(rejected.status).toBe(403);
  });
});
