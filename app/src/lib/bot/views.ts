// Read-only answers the bot builds from the database (and the live balance when it can).
import { formatDate, formatPesos } from "@/lib/report/format";
import { getPanelData, type PanelData } from "@/lib/report/panel";
import { contributionsOf } from "@/lib/orchestrator/contribute";
import type { AgentDeps } from "@/lib/orchestrator/deps";
import { urls } from "@/lib/orchestrator/links";

async function panel(deps: AgentDeps): Promise<PanelData | null> {
  return getPanelData(deps.db, { now: deps.now(), liveBalance: () => deps.chain.treasuryBalance() });
}

const ruleText = (rule: "auto" | "signers") => (rule === "auto" ? "automático" : "con firmas");

/** "¿En qué se gastó?" */
export async function spendingSummary(deps: AgentDeps): Promise<string> {
  const data = await panel(deps);
  const link = urls.panel(deps.appUrl);
  if (!data) return `Todavía no hay datos de la cooperadora. El panel público está en ${link}`;
  const lines = [`Hoy la cooperadora tiene ${formatPesos(data.balance)}.`];
  if (data.expenses.length === 0) {
    lines.push("", "Todavía no hubo gastos.");
  } else {
    lines.push("", "Últimos gastos:");
    for (const e of data.expenses.slice(0, 5)) {
      lines.push(`• ${formatDate(e.date)} · ${e.vendor} · ${formatPesos(e.amount)} · ${e.lineName} (${ruleText(e.rule)})`);
    }
  }
  if (data.lines.length > 0) {
    lines.push("", "Partidas:");
    for (const l of data.lines) {
      lines.push(`• ${l.name}: se usaron ${formatPesos(l.spent)} de ${formatPesos(l.allocated)}`);
    }
  }
  lines.push("", `Cada gasto, con su factura y su comprobante, está en el panel público: ${link}`);
  return lines.join("\n");
}

/** Context for Claude: the same facts, compact. */
export async function treasuryContext(deps: AgentDeps): Promise<string> {
  const data = await panel(deps);
  if (!data) return "Sin datos todavía.";
  const out = [
    `Cooperadora: ${data.header.cooperadora} (${data.header.school}).`,
    `Saldo: ${formatPesos(data.balance)}.`,
    `Partidas: ${data.lines.map((l) => `${l.name} asignado ${formatPesos(l.allocated)}, gastado ${formatPesos(l.spent)}, disponible ${formatPesos(l.available)}`).join("; ") || "ninguna"}.`,
    `Últimos pagos: ${data.expenses.slice(0, 5).map((e) => `${formatDate(e.date)} ${e.vendor} ${formatPesos(e.amount)} (${e.lineName}, ${ruleText(e.rule)})`).join("; ") || "ninguno"}.`,
    `Pagos esperando firmas: ${data.pending.length}.`,
    `Rendiciones publicadas: ${data.publishedReports.map((r) => r.period).join(", ") || "ninguna"}.`,
    `Panel público: ${urls.panel(deps.appUrl)}`,
  ];
  return out.join("\n");
}

/** "Mis aportes". Never framed as a debt: the cuota is voluntary. */
export async function myContributions(deps: AgentDeps, personId: number): Promise<string> {
  const rows = await contributionsOf(deps, personId, 10);
  if (rows.length === 0) {
    return "Todavía no registramos aportes tuyos. Si querés sumar, tocá «Aportar»: cualquier monto ayuda, y es voluntario.";
  }
  const total = rows.reduce((acc, r) => acc + BigInt(r.amount), BigInt(0));
  return [
    "Tus aportes:",
    ...rows.map((r) => `• ${formatDate(r.occurredAt)} · ${formatPesos(r.amount)}`),
    "",
    `En total: ${formatPesos(total)}. ¡Gracias por acompañar a la cooperadora!`,
  ].join("\n");
}

/** Pending payments for "Pagos pendientes". */
export async function pendingPayments(deps: AgentDeps) {
  const data = await panel(deps);
  return data?.pending ?? [];
}
