// The landing's live demo: a small, pure model of the treasury and scripted chats that drive it.
// Numbers follow scripts/config/demo.json (caps, lines, threshold). The auto-pay rule is the same
// four checks as TreasuryPolicy.sol: per-payment cap, room in the line, vendor's monthly cap, balance.
// Scripts are replayed from the list of choices made so far, so every frame is deterministic.

export const CAPS = { perPayment: 50_000, vendorMonthly: 150_000 } as const;
export const THRESHOLD = 2;

export type LineId = "materiales" | "mantenimiento" | "comedor" | "eventos" | "imprevistos";
export type VendorId = "pepe" | "tornillo";

export type Line = { id: LineId; name: string; allocated: number; spent: number };
export type Vendor = { id: VendorId; name: string; paidThisMonth: number };
export type Pending = { id: number; label: string; vendor: VendorId; line: LineId; amount: number; approvals: number };
export type LedgerEvent = { id: number; kind: "in" | "auto" | "wait" | "signed" | "rejected"; text: string; amount: number };

export type Treasury = {
  balance: number;
  contributions: number;
  lines: Record<LineId, Line>;
  vendors: Record<VendorId, Vendor>;
  pending: Pending[];
  events: LedgerEvent[];
  nextId: number;
};

export const LINE_ORDER: LineId[] = ["materiales", "mantenimiento", "comedor", "eventos", "imprevistos"];

export function initialTreasury(): Treasury {
  return {
    balance: 412_500,
    contributions: 86,
    lines: {
      materiales: { id: "materiales", name: "Materiales", allocated: 300_000, spent: 182_000 },
      mantenimiento: { id: "mantenimiento", name: "Mantenimiento", allocated: 200_000, spent: 156_000 },
      comedor: { id: "comedor", name: "Comedor", allocated: 400_000, spent: 241_000 },
      eventos: { id: "eventos", name: "Eventos", allocated: 100_000, spent: 35_000 },
      imprevistos: { id: "imprevistos", name: "Imprevistos", allocated: 50_000, spent: 0 },
    },
    vendors: {
      pepe: { id: "pepe", name: "Librería Don Pepe", paidThisMonth: 40_000 },
      tornillo: { id: "tornillo", name: "Ferretería El Tornillo", paidThisMonth: 0 },
    },
    pending: [],
    events: [],
    nextId: 1,
  };
}

/** "$ 28.400", Argentine grouping, no cents. Deterministic on any runtime. */
export function pesos(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$ ${String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export type RuleId = "perPayment" | "line" | "vendor" | "balance";
export type RuleResult = { id: RuleId; label: string; used: number; amount: number; limit: number; ok: boolean; why: string };

/** The four checks the contract runs before paying without signatures. */
export function checkRules(t: Treasury, p: { amount: number; line: LineId; vendor: VendorId }) {
  const line = t.lines[p.line];
  const vendor = t.vendors[p.vendor];
  const rules: RuleResult[] = [
    { id: "perPayment", label: "Cap per payment", used: 0, amount: p.amount, limit: CAPS.perPayment, ok: p.amount <= CAPS.perPayment, why: `over the ${pesos(CAPS.perPayment)} cap per payment` },
    { id: "line", label: `Room in ${line.name}`, used: line.spent, amount: p.amount, limit: line.allocated, ok: line.spent + p.amount <= line.allocated, why: `more than what's left in ${line.name}` },
    { id: "vendor", label: `${vendor.name} this month`, used: vendor.paidThisMonth, amount: p.amount, limit: CAPS.vendorMonthly, ok: vendor.paidThisMonth + p.amount <= CAPS.vendorMonthly, why: `over the ${pesos(CAPS.vendorMonthly)} monthly cap for this vendor` },
    { id: "balance", label: "Co-op balance", used: 0, amount: p.amount, limit: t.balance, ok: p.amount <= t.balance, why: "more than the co-op has" },
  ];
  return { rules, auto: rules.every((r) => r.ok) };
}

function withEvent(t: Treasury, e: Omit<LedgerEvent, "id">): Treasury {
  return { ...t, events: [{ ...e, id: t.nextId }, ...t.events].slice(0, 6), nextId: t.nextId + 1 };
}

function spend(t: Treasury, line: LineId, vendor: VendorId, amount: number): Treasury {
  return {
    ...t,
    balance: t.balance - amount,
    lines: { ...t.lines, [line]: { ...t.lines[line], spent: t.lines[line].spent + amount } },
    vendors: { ...t.vendors, [vendor]: { ...t.vendors[vendor], paidThisMonth: t.vendors[vendor].paidThisMonth + amount } },
  };
}

export function contribute(t: Treasury, amount: number): Treasury {
  return withEvent({ ...t, balance: t.balance + amount, contributions: t.contributions + 1 }, { kind: "in", text: "Contribution, no name shown", amount });
}

/** Pays on the spot when every rule passes; otherwise it waits for signatures. */
export function submitInvoice(t: Treasury, p: { label: string; amount: number; line: LineId; vendor: VendorId }) {
  const check = checkRules(t, p);
  if (check.auto) {
    const paid = withEvent(spend(t, p.line, p.vendor, p.amount), { kind: "auto", text: `${t.vendors[p.vendor].name} · paid automatically`, amount: p.amount });
    return { treasury: paid, check, pendingId: null as number | null };
  }
  const id = t.nextId;
  const waiting = withEvent({ ...t, nextId: id + 1, pending: [...t.pending, { id, approvals: 0, ...p }] }, { kind: "wait", text: `${t.vendors[p.vendor].name} · waiting for signatures`, amount: p.amount });
  return { treasury: waiting, check, pendingId: id };
}

/** One signer approves. At the threshold the payment goes out, even past its line (it's flagged). */
export function approve(t: Treasury, pendingId: number): { treasury: Treasury; executed: boolean } {
  const p = t.pending.find((x) => x.id === pendingId);
  if (!p) return { treasury: t, executed: false };
  const approvals = p.approvals + 1;
  if (approvals < THRESHOLD) {
    return { treasury: { ...t, pending: t.pending.map((x) => (x.id === pendingId ? { ...x, approvals } : x)) }, executed: false };
  }
  const rest = { ...t, pending: t.pending.filter((x) => x.id !== pendingId) };
  return { treasury: withEvent(spend(rest, p.line, p.vendor, p.amount), { kind: "signed", text: `${t.vendors[p.vendor].name} · paid with ${THRESHOLD} signatures`, amount: p.amount }), executed: true };
}

export function reject(t: Treasury, pendingId: number): Treasury {
  const p = t.pending.find((x) => x.id === pendingId);
  if (!p) return t;
  return withEvent({ ...t, pending: t.pending.filter((x) => x.id !== pendingId) }, { kind: "rejected", text: `${t.vendors[p.vendor].name} · rejected, not paid`, amount: p.amount });
}

// ---------- Scripted chats ----------

export type Msg =
  | { from: "bot"; text: string; action?: string }
  | { from: "user"; text: string; file?: boolean }
  | { from: "system"; text: string };

export type Prompt = { kind: "choice"; options: string[] } | { kind: "end" };
/** states[i] is the treasury as it stands once messages[i] is on screen, so the ledger moves with the chat. */
export type Frame = { messages: Msg[]; states: Treasury[]; treasury: Treasury; prompt: Prompt };

class Pause {
  constructor(readonly options: string[]) {}
}

type IO = {
  bot: (text: string, action?: string) => void;
  user: (text: string, file?: boolean) => void;
  system: (text: string) => void;
  ask: (options: string[]) => string;
  get t(): Treasury;
  set: (t: Treasury) => void;
};

export type Scenario = { id: string; title: string; who: string; role: string; script: (io: IO) => void };

export function play(scenario: Scenario, choices: string[], start: Treasury): Frame {
  const messages: Msg[] = [];
  const states: Treasury[] = [];
  let t = start;
  let i = 0;
  const push = (m: Msg) => {
    messages.push(m);
    states.push(t);
  };
  const io: IO = {
    bot: (text, action) => push({ from: "bot", text, action }),
    user: (text, file) => push({ from: "user", text, file }),
    system: (text) => push({ from: "system", text }),
    ask: (options) => {
      if (i >= choices.length) throw new Pause(options);
      const c = choices[i++];
      return options.includes(c) ? c : options[0];
    },
    get t() {
      return t;
    },
    set: (next) => {
      t = next;
    },
  };
  try {
    scenario.script(io);
  } catch (e) {
    if (e instanceof Pause) return { messages, states, treasury: t, prompt: { kind: "choice", options: e.options } };
    throw e;
  }
  return { messages, states, treasury: t, prompt: { kind: "end" } };
}

const amountOf = (label: string) => Number(label.replace(/\D/g, ""));
const lineOf = (label: string) => LINE_ORDER.find((id) => label.toLowerCase().startsWith(id)) ?? "materiales";

export const SCENARIOS: Scenario[] = [
  {
    id: "contribute",
    title: "A family chips in",
    who: "Jorge",
    role: "Parent",
    script: (io) => {
      io.ask(["Contribute"]);
      io.user("Contribute");
      io.bot(`How much would you like to give? It's voluntary, and nobody else sees how much you give. Most families give ${pesos(5_000)}.`);
      const pick = io.ask([pesos(2_000), pesos(5_000), pesos(10_000)]);
      io.user(pick);
      const amount = amountOf(pick);
      io.bot(`Here's your link to pay ${pesos(amount)} from any bank app or wallet, in pesos. I'll send the receipt as soon as it lands.`, "Open payment link");
      io.ask(["Pay from my bank app"]);
      io.system("Payment sent from the bank app");
      io.set(contribute(io.t, amount));
      io.bot(`Got it: ${pesos(amount)} on Oct 15. Thank you! It's already on the public ledger, without your name.`, "View movement");
    },
  },
  {
    id: "small",
    title: "A small bill",
    who: "Daniela",
    role: "Board secretary",
    script: (io) => {
      io.ask(["Upload invoice"]);
      io.user("Upload invoice");
      io.bot("Send me a photo or the PDF of the invoice.");
      io.ask(["Send the photo"]);
      io.user("Invoice C 0003-00001234 · Librería Don Pepe · $ 28.400", true);
      io.bot(`I read Invoice C 0003-00001234 from Librería Don Pepe for ${pesos(28_400)}. It's addressed to the co-op and the vendor is approved.\n\nWhich budget line does it come from?`);
      const line = lineOf(io.ask(["Materiales (suggested)", "Eventos", "Comedor"]));
      io.user(io.t.lines[line].name);
      const r = submitInvoice(io.t, { label: "Invoice C 0003-00001234", amount: 28_400, line, vendor: "pepe" });
      io.set(r.treasury);
      if (r.check.auto) {
        io.bot(`Done, I paid Invoice C 0003-00001234 from ${io.t.lines[line].name}. It fit every automatic payment rule.`, "View movement");
        io.system("The account auditor gets a heads-up as it happens");
      } else {
        io.bot(`This one doesn't fit the automatic rules (${r.check.rules.filter((x) => !x.ok).map((x) => x.why).join("; ")}), so it needs ${THRESHOLD} signatures. I've sent it to the signers.`);
      }
    },
  },
  {
    id: "big",
    title: "A big repair",
    who: "Daniela",
    role: "Board secretary",
    script: (io) => {
      io.ask(["Upload invoice"]);
      io.user("Upload invoice");
      io.bot("Send me a photo or the PDF of the invoice.");
      io.ask(["Send the photo"]);
      io.user("Invoice A 0002-00000456 · Ferretería El Tornillo · $ 86.000", true);
      io.bot(`I read Invoice A 0002-00000456 from Ferretería El Tornillo for ${pesos(86_000)}: fixing the boys' bathroom pipes. The vendor is approved.\n\nWhich budget line does it come from?`);
      const line = lineOf(io.ask(["Mantenimiento (suggested)", "Imprevistos"]));
      io.user(io.t.lines[line].name);
      const r = submitInvoice(io.t, { label: "Invoice A 0002-00000456", amount: 86_000, line, vendor: "tornillo" });
      io.set(r.treasury);
      const why = r.check.rules.filter((x) => !x.ok).map((x) => x.why).join(", and ");
      io.bot(`I can't pay this one on my own: it's ${why}. It needs ${THRESHOLD} signatures, so I've sent it to the signers. I'll let you know when it's paid.`);
      const id = r.pendingId!;
      const request = `A payment needs your signature:\nInvoice A 0002-00000456 · ${pesos(86_000)}\nLine: ${io.t.lines[line].name} · Uploaded by Daniela`;

      io.system("Meanwhile, on Rosa's phone (president)");
      io.bot(request, "Review and sign");
      if (io.ask(["Sign with fingerprint", "Reject"]) === "Reject") {
        io.user("Rejected");
        io.set(reject(io.t, id));
        io.bot("Rejected. Nothing was paid, and the rejection is on the public ledger.");
        return;
      }
      io.user("Signed with fingerprint");
      io.set(approve(io.t, id).treasury);
      io.bot(`Thanks. That's 1 of ${THRESHOLD} signatures; one more to go.`);

      io.system("On Marcelo's phone (treasurer)");
      io.bot(request, "Review and sign");
      io.ask(["Sign with fingerprint"]);
      io.user("Signed with fingerprint");
      io.set(approve(io.t, id).treasury);
      io.bot("Paid with the board's signatures. Thanks for signing!", "View movement");
      const l = io.t.lines[line];
      if (l.spent > l.allocated) io.system(`${l.name} is now ${pesos(l.spent - l.allocated)} over its line. The public ledger flags it, nothing hides`);

      io.system("Back on Daniela's phone");
      io.bot("Invoice A 0002-00000456 is paid. It got the signatures it needed.");
    },
  },
  {
    id: "ask",
    title: "Where did the money go?",
    who: "Jorge",
    role: "Parent",
    script: (io) => {
      io.ask(["Where did the money go?"]);
      io.user("Where did the money go?");
      const lines = LINE_ORDER.map((id) => io.t.lines[id]);
      const spent = lines.reduce((s, l) => s + l.spent, 0);
      io.bot(
        `This year the co-op spent ${pesos(spent)}. By line:\n` +
          lines.map((l) => `• ${l.name}: ${pesos(l.spent)} of ${pesos(l.allocated)}${l.spent > l.allocated ? " (over)" : ""}`).join("\n") +
          `\n\nThe balance today is ${pesos(io.t.balance)}. Every payment, with its invoice, is on the public ledger.`,
        "Open the public ledger",
      );
      const q = io.ask(["Is any line over budget?", "How much is left for the canteen?"]);
      io.user(q);
      if (q.startsWith("Is any")) {
        const over = lines.filter((l) => l.spent > l.allocated);
        io.bot(
          over.length
            ? over.map((l) => `${l.name} is ${pesos(l.spent - l.allocated)} over. A payment past the line can only go out with ${THRESHOLD} signatures, and it stays flagged.`).join("\n")
            : "No. Every line is within what the assembly voted. A payment past its line would need signatures and would be flagged.",
        );
      } else {
        const c = io.t.lines.comedor;
        io.bot(`The canteen (Comedor) has ${pesos(c.allocated - c.spent)} left of ${pesos(c.allocated)} for the year.`);
      }
    },
  },
];
