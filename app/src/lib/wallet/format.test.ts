import { describe, expect, it } from "vitest";
import { formatCuit, formatPesos, parsePesos, shortAddress } from "./format";

const E18 = BigInt(10) ** BigInt(18);

describe("pesos", () => {
  it("formats base units as es-AR pesos", () => {
    expect(formatPesos(BigInt(12500) * E18)).toBe("$ 12.500,00");
    expect(formatPesos((BigInt(100000) * E18 + E18 / BigInt(2)).toString())).toBe("$ 100.000,50");
    expect(formatPesos(BigInt(0))).toBe("$ 0,00");
  });

  it("parses what people type", () => {
    expect(parsePesos("100000")).toBe(BigInt(100000) * E18);
    expect(parsePesos("100.000")).toBe(BigInt(100000) * E18);
    expect(parsePesos("$ 1.500,5")).toBe(BigInt(1500) * E18 + E18 / BigInt(2));
    expect(parsePesos("0")).toBeNull();
    expect(parsePesos("12,345")).toBeNull();
    expect(parsePesos("1.50")).toBeNull();
    expect(parsePesos("abc")).toBeNull();
  });
});

it("formats CUIT and addresses", () => {
  expect(formatCuit(BigInt(20123456789))).toBe("20-12345678-9");
  expect(shortAddress("0x3333333333333333333333333333333333334444")).toBe("0x3333…4444");
});
