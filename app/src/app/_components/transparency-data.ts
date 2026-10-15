// The demo co-op's year so far, payment by payment. Totals per line match initialTreasury() in
// demo-model.ts, so the spending chart, the chat demo and the rule check all tell the same story.
import { initialTreasury, type LineId } from "./demo-model";

export type Payment = {
  date: string; // "Mar 12"
  vendor: string;
  concept: string;
  invoice: string;
  amount: number;
  rule: "auto" | "signed";
};

export const PAYMENTS: Record<LineId, Payment[]> = {
  comedor: [
    { date: "Aug 20", vendor: "Panadería Sol", concept: "Bread for the canteen, August", invoice: "Invoice C 0002-00000871", amount: 48_000, rule: "auto" },
    { date: "Jun 11", vendor: "Distribuidora La Quiaca", concept: "Dry goods, winter stock", invoice: "Invoice A 0004-00012040", amount: 60_000, rule: "signed" },
    { date: "May 14", vendor: "Verdulería Don Tito", concept: "Fruit and vegetables, May", invoice: "Invoice C 0001-00000398", amount: 37_000, rule: "auto" },
    { date: "Apr 9", vendor: "Distribuidora La Quiaca", concept: "Dry goods, April", invoice: "Invoice A 0004-00011712", amount: 48_000, rule: "auto" },
    { date: "Mar 12", vendor: "Distribuidora La Quiaca", concept: "Dry goods, March", invoice: "Invoice A 0004-00011388", amount: 48_000, rule: "auto" },
  ],
  materiales: [
    { date: "Sep 2", vendor: "Librería Don Pepe", concept: "Notebooks and markers, 2nd term", invoice: "Invoice C 0003-00001190", amount: 43_000, rule: "auto" },
    { date: "Jun 5", vendor: "Papelera Jujuy", concept: "Paper for the whole year", invoice: "Invoice A 0001-00004410", amount: 61_500, rule: "signed" },
    { date: "Apr 22", vendor: "Librería Don Pepe", concept: "Art supplies", invoice: "Invoice C 0003-00001021", amount: 32_500, rule: "auto" },
    { date: "Mar 3", vendor: "Librería Don Pepe", concept: "Back-to-school kits", invoice: "Invoice C 0003-00000954", amount: 45_000, rule: "auto" },
  ],
  mantenimiento: [
    { date: "Aug 7", vendor: "Ferretería El Tornillo", concept: "Locks for two classrooms", invoice: "Invoice A 0002-00000431", amount: 48_000, rule: "auto" },
    { date: "May 28", vendor: "Pinturería Color", concept: "Paint for the playground walls", invoice: "Invoice A 0005-00002317", amount: 70_000, rule: "signed" },
    { date: "Apr 2", vendor: "Ferretería El Tornillo", concept: "Tap and pipe fittings", invoice: "Invoice A 0002-00000402", amount: 38_000, rule: "auto" },
  ],
  eventos: [{ date: "Aug 16", vendor: "Sonido Andino", concept: "Sound system, Children's Day", invoice: "Invoice C 0001-00000077", amount: 35_000, rule: "auto" }],
  imprevistos: [],
};

const T = initialTreasury();
const spentOf = (id: LineId) => PAYMENTS[id].reduce((s, p) => s + p.amount, 0);

export const TOTALS = (() => {
  const spent = (Object.keys(PAYMENTS) as LineId[]).reduce((s, id) => s + spentOf(id), 0);
  const count = (Object.keys(PAYMENTS) as LineId[]).reduce((s, id) => s + PAYMENTS[id].length, 0);
  return {
    collected: T.balance + spent,
    contributions: T.contributions,
    spent,
    balance: T.balance,
    payments: count,
    signed: (Object.keys(PAYMENTS) as LineId[]).reduce((s, id) => s + PAYMENTS[id].filter((p) => p.rule === "signed").length, 0),
  };
})();

/** Segments of the "where the money went" bar. Three named lines, the rest folded into Other, then what is left. */
export type SegmentId = "comedor" | "materiales" | "mantenimiento" | "other" | "left";
export type Segment = { id: SegmentId; name: string; amount: number; lines: LineId[]; color: string; ink: "white" | "ink" };

// Categorical slots, validated with the dataviz palette script (light surface): blue, mustard, red.
export const SEGMENTS: Segment[] = [
  { id: "comedor", name: "Canteen (Comedor)", amount: spentOf("comedor"), lines: ["comedor"], color: "#2f7de1", ink: "white" },
  { id: "materiales", name: "School supplies (Materiales)", amount: spentOf("materiales"), lines: ["materiales"], color: "#d6a400", ink: "ink" },
  { id: "mantenimiento", name: "Repairs (Mantenimiento)", amount: spentOf("mantenimiento"), lines: ["mantenimiento"], color: "#e53b2c", ink: "white" },
  { id: "other", name: "Events and other", amount: spentOf("eventos") + spentOf("imprevistos"), lines: ["eventos", "imprevistos"], color: "#8c8b85", ink: "white" },
  { id: "left", name: "Still in the account", amount: T.balance, lines: [], color: "transparent", ink: "ink" },
];

export function lineBudget(ids: LineId[]) {
  return ids.reduce((acc, id) => ({ allocated: acc.allocated + T.lines[id].allocated, spent: acc.spent + T.lines[id].spent }), { allocated: 0, spent: 0 });
}

// ---------- Today, live: movements that land on the ledger while the visitor watches ----------

export type LiveEvent =
  | { kind: "in"; amount: number; text: string }
  | { kind: "out"; line: LineId; payment: Payment };

const today = (p: Omit<Payment, "date">): Payment => ({ date: "Today", ...p });

/** The same day the chat demo plays: contributions arrive, two bills are paid, one big repair needs signatures. */
export const LIVE: LiveEvent[] = [
  { kind: "in", amount: 5_000, text: "Contribution from a family" },
  { kind: "out", line: "materiales", payment: today({ vendor: "Librería Don Pepe", concept: "Notebooks for 1st grade", invoice: "Invoice C 0003-00001234", amount: 28_400, rule: "auto" }) },
  { kind: "in", amount: 10_000, text: "Contribution from a family" },
  { kind: "in", amount: 2_000, text: "Contribution from a teacher" },
  { kind: "out", line: "mantenimiento", payment: today({ vendor: "Ferretería El Tornillo", concept: "Boys' bathroom pipes", invoice: "Invoice A 0002-00000456", amount: 86_000, rule: "signed" }) },
  { kind: "in", amount: 5_000, text: "Contribution from a family" },
  { kind: "out", line: "comedor", payment: today({ vendor: "Verdulería Don Tito", concept: "Fruit for the canteen", invoice: "Invoice C 0001-00000455", amount: 19_500, rule: "auto" }) },
  { kind: "in", amount: 3_000, text: "Contribution, no name shown" },
];

const SEGMENT_DEFS: Array<Omit<Segment, "amount">> = SEGMENTS.map((s) => ({ id: s.id, name: s.name, lines: s.lines, color: s.color, ink: s.ink }));

/** Everything the spending section shows after the first `n` live events. */
export function ledgerAt(n: number) {
  const events = LIVE.slice(0, n);
  const payments: Record<LineId, Payment[]> = { ...PAYMENTS };
  let income = 0;
  let outflow = 0;
  for (const e of events) {
    if (e.kind === "in") income += e.amount;
    else {
      outflow += e.payment.amount;
      payments[e.line] = [e.payment, ...payments[e.line]];
    }
  }
  const spentOn = (ids: LineId[]) => ids.reduce((s, id) => s + payments[id].reduce((a, p) => a + p.amount, 0), 0);
  const balance = TOTALS.balance + income - outflow;
  const segments: Segment[] = SEGMENT_DEFS.map((d) => ({ ...d, amount: d.id === "left" ? balance : spentOn(d.lines) }));
  const count = (Object.values(payments) as Payment[][]).reduce((s, l) => s + l.length, 0);
  const signed = (Object.values(payments) as Payment[][]).reduce((s, l) => s + l.filter((p) => p.rule === "signed").length, 0);
  return {
    payments,
    segments,
    totals: { collected: TOTALS.collected + income, contributions: TOTALS.contributions + events.filter((e) => e.kind === "in").length, spent: TOTALS.spent + outflow, balance, payments: count, signed },
    feed: events.slice().reverse(),
  };
}
