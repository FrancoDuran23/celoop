import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { VendorPanel } from "./vendor-panel";

const E18 = BigInt(10) ** BigInt(18);

it("vendor page: balance, withdraw button and payments", () => {
  const html = renderToString(
    createElement(VendorPanel, {
      name: "Beto",
      wars: "0x2222222222222222222222222222222222222222",
      signer: {
        token: "t",
        credential: { id: "c", publicKey: `0x04${"11".repeat(64)}` },
        safe: "0x4444444444444444444444444444444444444444",
        chainId: 42220,
        rpId: "localhost",
        attributionSuffix: "0x00",
      },
      view: {
        legalName: "Ferretería El Tornillo",
        address: "0x4444444444444444444444444444444444444444",
        canTransfer: true,
        balance: (BigInt(12500) * E18).toString(),
        payments: [{ paymentId: "3", amount: (BigInt(12500) * E18).toString(), status: "executed", invoiceLabel: "Factura C 00002-00000345", date: "2026-10-01T12:00:00Z" }],
      },
    }),
  );
  const t = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(t).toContain("$ 12.500,00");
  expect(t).toContain("Pasar a mi cuenta bancaria");
  expect(t).toContain("Factura C 00002-00000345");
  expect(t).toContain("Cobrado");
});
