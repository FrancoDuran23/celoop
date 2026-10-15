import { expect, test } from "vitest";
import { formatCuit, formatDate, formatPesos, periodRange, previousPeriod, pesosToBase } from "./format";

test("formats pesos in es-AR", () => {
  expect(formatPesos("12500000000000000000000")).toBe("$ 12.500,00");
  expect(formatPesos("0")).toBe("$ 0,00");
  expect(formatPesos("1234567890000000000")).toBe("$ 1,23");
  expect(formatPesos("-1500000000000000000000")).toBe("-$ 1.500,00");
  expect(formatPesos(pesosToBase("12500.5"))).toBe("$ 12.500,50");
});

test("dates use Argentine time", () => {
  expect(formatDate("2026-10-01T02:00:00Z")).toBe("30/09/2026");
  expect(periodRange("2026-10").start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  expect(previousPeriod(new Date("2026-01-03T12:00:00Z"))).toBe("2025-12");
  expect(formatCuit("30712345678")).toBe("30-71234567-8");
});
