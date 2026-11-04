import { describe, expect, it } from "vitest";
import {
  formatZcashName,
  looksLikeZcashName,
  parseZcashNameInput,
} from "@/features/zns/parse";

describe("parseZcashNameInput", () => {
  it("accepts .zcash and .zec suffixes", () => {
    expect(parseZcashNameInput("alice.zcash")).toEqual({
      name: "alice",
      display: "alice.zcash",
    });
    expect(parseZcashNameInput("Bob.ZEC")).toEqual({
      name: "bob",
      display: "bob.zcash",
    });
  });

  it("rejects bare labels and addresses", () => {
    expect(parseZcashNameInput("alice")).toBeNull();
    expect(parseZcashNameInput("utest1qqqq")).toBeNull();
    expect(parseZcashNameInput("alice.cash")).toBeNull();
    expect(parseZcashNameInput("al ice.zcash")).toBeNull();
  });

  it("rejects invalid name bodies", () => {
    expect(parseZcashNameInput("alice!.zcash")).toBeNull();
    expect(parseZcashNameInput(`${"a".repeat(64)}.zcash`)).toBeNull();
  });

  it("exposes helpers", () => {
    expect(looksLikeZcashName("david.zcash")).toBe(true);
    expect(formatZcashName("Lana")).toBe("lana.zcash");
  });
});
