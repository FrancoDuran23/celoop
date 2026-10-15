import { describe, expect, it } from "vitest";
import { ripioOfframpUrl } from "./ripio";

const pesos = (n: number) => BigInt(Math.round(n * 100)) * BigInt(10) ** BigInt(16);

describe("ripioOfframpUrl", () => {
  it("opens Ripio's off-ramp on Celo with wARS, the amount and the Safe", () => {
    const url = new URL(ripioOfframpUrl({ amount: pesos(12500), address: "0x3333333333333333333333333333333333333333" }));
    expect(url.origin + url.pathname).toBe("https://ramp.ripio.com/off-ramp");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      mode: "offramp",
      country: "AR",
      chain: "42220",
      token: "WARS",
      amount: "12500",
      address: "0x3333333333333333333333333333333333333333",
    });
  });

  it("writes decimals with a dot and no thousands separator", () => {
    const url = new URL(ripioOfframpUrl({ amount: pesos(1234567.5) }));
    expect(url.searchParams.get("amount")).toBe("1234567.5");
    expect(url.searchParams.has("address")).toBe(false);
  });

  it("refuses a zero amount", () => {
    expect(() => ripioOfframpUrl({ amount: BigInt(0) })).toThrow();
  });
});
