import { describe, it, expect, vi } from "vitest";
import {
  fetchPreview,
  validatePreview,
  formatUnits,
  selectPair,
} from "./preview";
import { POST } from "@/app/api/routes/preview/route";
const input = {
  amount: "0.1",
  chain: "base" as const,
  recipient: `0x${"a".repeat(40)}`,
  refundTo: `t1${"a".repeat(33)}`,
  consent: true,
};
const tokens = [
  { assetId: "zec-live-id", blockchain: "zec", symbol: "ZEC", decimals: 8 },
  { assetId: "usdc-live-id", blockchain: "base", symbol: "USDC", decimals: 6 },
];
describe("1Click preview boundary", () => {
  it("requires consent and rejects testnet refunds", () => {
    expect(() => validatePreview({ ...input, consent: false })).toThrow(
      "Approve",
    );
    expect(() =>
      validatePreview({ ...input, refundTo: "utest1example" }),
    ).toThrow("mainnet");
  });
  it("rejects invalid amounts and addresses", () => {
    for (const patch of [
      { amount: "1e3" },
      { amount: "0" },
      { amount: "0.000000001" },
      { chain: "eth" },
      { recipient: "0xabc" },
    ])
      expect(() => validatePreview({ ...input, ...patch })).toThrow();
  });
  it("discovers live asset IDs and rejects missing pairs", () => {
    expect(selectPair(tokens, "base").origin.assetId).toBe("zec-live-id");
    expect(() => selectPair(tokens, "sol")).toThrow("not currently available");
  });
  it("preserves exact integer units", () => {
    expect(formatUnits("10000000", 6)).toBe("10");
    expect(formatUnits("9007199254740993123456", 6)).toBe(
      "9007199254740993.123456",
    );
  });
  it("forces dry quotes and strips deposit addresses", async () => {
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
          },
        }),
      );
    const result = await fetchPreview(input, fetcher);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      dry: true,
      amount: "10000000",
      originAsset: "zec-live-id",
      destinationAsset: "usdc-live-id",
    });
    expect(result.amountOut).toBe("12.345678");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
  });
  it("reports rate limits", async () => {
    await expect(
      fetchPreview(
        input,
        vi.fn().mockResolvedValue(new Response("", { status: 429 })),
      ),
    ).rejects.toThrow("rate limiting");
  });
  it("rejects mismatched amounts", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(
        Response.json({
          quote: { amountIn: "999", amountOut: "1", minAmountOut: "1" },
        }),
      );
    await expect(fetchPreview(input, f)).rejects.toThrow("mismatched");
  });
  it("rejects cross-origin requests", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/routes/preview", {
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
  it("accepts the browser Host when Next rewrites the internal URL", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/routes/preview", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...input, consent: false }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
