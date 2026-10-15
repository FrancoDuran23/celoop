// Smoke test: the signing screens render on the server without throwing and show the key facts.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SignerConfig } from "./_components/use-safe-action";
import { TelegramGate } from "./_components/telegram-gate";
import { EnrollPasskey } from "./_components/enroll";
import { PaymentSigner } from "./pago/[id]/payment-signer";
import { ProposalSigner } from "./propuesta/[id]/proposal-signer";
import { ProposeForm } from "./proponer/propose-form";

const E18 = BigInt(10) ** BigInt(18);
const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const signer: SignerConfig = {
  token: "t",
  credential: { id: "c", publicKey: `0x04${"11".repeat(64)}` },
  safe: "0x3333333333333333333333333333333333333333",
  chainId: 42220,
  rpId: "localhost",
  attributionSuffix: "0x00",
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&quot;/g, "'").replace(/\s+/g, " ");

describe("signing pages", () => {
  it("payment: vendor, CUIT, amount, line, invoice, signatures and the over-budget warning", () => {
    const html = renderToString(
      createElement(PaymentSigner, {
        name: "Ana",
        treasury: TREASURY,
        signer,
        view: {
          paymentId: "3",
          status: "pending",
          vendorName: "Ferretería El Tornillo",
          vendorAddress: TREASURY,
          cuit: "20123456789",
          amount: (BigInt(80000) * E18).toString(),
          lineName: "Mantenimiento",
          invoiceUrl: "https://blob/f.pdf",
          invoiceLabel: "Factura C 00002-00000345",
          approvals: 1,
          threshold: 2,
          overBudget: true,
          lineAvailable: (BigInt(50000) * E18).toString(),
          paused: false,
          alreadyApproved: false,
        },
      }),
    );
    const t = text(html);
    for (const s of ["Ferretería El Tornillo", "20-12345678-9", "$ 80.000,00", "Mantenimiento", "Ver la factura", "1 de 2 firmas", "falta 1", "supera lo que queda", "Aprobar", "Rechazar"]) {
      expect(t).toContain(s);
    }
    expect(t.toLowerCase()).not.toContain("gas");
  });

  it("proposal: the decoded change and both actions", () => {
    const t = text(
      renderToString(
        createElement(ProposalSigner, {
          name: "Ana",
          treasury: TREASURY,
          signer,
          view: {
            proposalId: "1",
            kind: "MoveBudget",
            summary: "Mover $ 100.000,00 de Eventos a Mantenimiento. Motivo: rotura de caño",
            reasonMatches: true,
            status: "open",
            approvals: 1,
            threshold: 2,
            paused: false,
            alreadyApproved: false,
          },
        }),
      ),
    );
    expect(t).toContain("Mover $ 100.000,00 de Eventos a Mantenimiento. Motivo: rotura de caño");
    expect(t).toContain("Aprobar");
    expect(t).toContain("Pausar todos los pagos");
  });

  it("propose form, enrollment and the Telegram gate render", () => {
    const lines = [
      { lineId: `0x${"01".repeat(32)}` as const, name: "Eventos", available: (BigInt(200000) * E18).toString() },
      { lineId: `0x${"02".repeat(32)}` as const, name: "Mantenimiento", available: null },
    ];
    expect(text(renderToString(createElement(ProposeForm, {
          context: { lines, vendors: [], vendorPeople: [], caps: { perTxCap: (BigInt(1000) * E18).toString(), vendorMonthlyCap: (BigInt(3000) * E18).toString() }, paused: false },
          treasury: TREASURY,
          signer,
          name: "Ana",
        })))).toContain(
      "Mover entre partidas",
    );
    expect(text(renderToString(createElement(EnrollPasskey, { token: "t", name: "Ana", rpId: "localhost" })))).toContain("Crear mi firma");
    expect(renderToString(createElement(TelegramGate, null, "contenido"))).toContain("contenido");
  });
});
