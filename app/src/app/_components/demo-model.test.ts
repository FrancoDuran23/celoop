import { describe, expect, it } from "vitest";
import { approve, CAPS, checkRules, contribute, initialTreasury, pesos, play, SCENARIOS, submitInvoice } from "./demo-model";

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;

describe("demo treasury", () => {
  it("formats pesos the Argentine way", () => {
    expect(pesos(28_400)).toBe("$ 28.400");
    expect(pesos(-2_000)).toBe("-$ 2.000");
  });

  it("applies the contract's four checks", () => {
    const t = initialTreasury();
    expect(checkRules(t, { amount: CAPS.perPayment, line: "materiales", vendor: "pepe" }).auto).toBe(true);
    const big = checkRules(t, { amount: CAPS.perPayment + 1, line: "materiales", vendor: "pepe" });
    expect(big.auto).toBe(false);
    expect(big.rules.filter((r) => !r.ok).map((r) => r.id)).toEqual(["perPayment"]);
    // Mantenimiento has 44.000 left: 45.000 fits the cap but not the line.
    expect(checkRules(t, { amount: 45_000, line: "mantenimiento", vendor: "tornillo" }).rules.find((r) => r.id === "line")!.ok).toBe(false);
    // Don Pepe already got 40.000 this month: another 49.000 twice would pass the monthly cap.
    const after = submitInvoice(t, { label: "x", amount: 49_000, line: "comedor", vendor: "pepe" }).treasury;
    const twice = submitInvoice(after, { label: "y", amount: 49_000, line: "comedor", vendor: "pepe" }).treasury;
    expect(checkRules(twice, { amount: 49_000, line: "comedor", vendor: "pepe" }).rules.find((r) => r.id === "vendor")!.ok).toBe(false);
  });

  it("pays small invoices at once and makes big ones wait for two signatures", () => {
    const t = initialTreasury();
    const small = submitInvoice(t, { label: "s", amount: 28_400, line: "materiales", vendor: "pepe" });
    expect(small.pendingId).toBeNull();
    expect(small.treasury.balance).toBe(t.balance - 28_400);

    const big = submitInvoice(t, { label: "b", amount: 86_000, line: "mantenimiento", vendor: "tornillo" });
    expect(big.treasury.balance).toBe(t.balance);
    const one = approve(big.treasury, big.pendingId!);
    expect(one.executed).toBe(false);
    const two = approve(one.treasury, big.pendingId!);
    expect(two.executed).toBe(true);
    expect(two.treasury.balance).toBe(t.balance - 86_000);
    expect(two.treasury.lines.mantenimiento.spent).toBeGreaterThan(two.treasury.lines.mantenimiento.allocated);
    expect(two.treasury.pending).toEqual([]);
  });

  it("contributions raise the balance and never carry a name", () => {
    const t = contribute(initialTreasury(), 5_000);
    expect(t.balance).toBe(initialTreasury().balance + 5_000);
    expect(t.events[0].text).toContain("no name");
  });
});

describe("scripted chats", () => {
  it("pause at each choice and replay deterministically", () => {
    const start = initialTreasury();
    const first = play(scenario("contribute"), [], start);
    expect(first.messages).toEqual([]);
    expect(first.prompt).toEqual({ kind: "choice", options: ["Contribute"] });
    const done = play(scenario("contribute"), ["Contribute", "$ 10.000", "Pay from my bank app"], start);
    expect(done.prompt.kind).toBe("end");
    expect(done.treasury.balance).toBe(start.balance + 10_000);
    expect(play(scenario("contribute"), ["Contribute", "$ 10.000", "Pay from my bank app"], start)).toEqual(done);
  });

  it("the big repair needs both signers before money moves", () => {
    const start = initialTreasury();
    const s = scenario("big");
    const waiting = play(s, ["Upload invoice", "Send the photo", "Mantenimiento (suggested)"], start);
    expect(waiting.treasury.pending).toHaveLength(1);
    expect(waiting.treasury.balance).toBe(start.balance);
    const oneSig = play(s, ["Upload invoice", "Send the photo", "Mantenimiento (suggested)", "Sign with fingerprint"], start);
    expect(oneSig.treasury.pending[0].approvals).toBe(1);
    const paid = play(s, ["Upload invoice", "Send the photo", "Mantenimiento (suggested)", "Sign with fingerprint", "Sign with fingerprint"], start);
    expect(paid.prompt.kind).toBe("end");
    expect(paid.treasury.balance).toBe(start.balance - 86_000);
    const rejected = play(s, ["Upload invoice", "Send the photo", "Mantenimiento (suggested)", "Reject"], start);
    expect(rejected.treasury.balance).toBe(start.balance);
    expect(rejected.treasury.pending).toEqual([]);
  });

  it("every scenario reaches its end following the first option", () => {
    for (const s of SCENARIOS) {
      const choices: string[] = [];
      let f = play(s, choices, initialTreasury());
      for (let guard = 0; f.prompt.kind === "choice" && guard < 20; guard++) {
        choices.push(f.prompt.options[0]);
        f = play(s, choices, initialTreasury());
      }
      expect(f.prompt.kind, s.id).toBe("end");
      expect(f.messages.length, s.id).toBeGreaterThan(2);
    }
  });
});

describe("spending data", async () => {
  const { PAYMENTS, SEGMENTS, TOTALS } = await import("./transparency-data");
  it("adds up to the same treasury the chat demo starts from", () => {
    const t = initialTreasury();
    for (const id of Object.keys(PAYMENTS) as (keyof typeof PAYMENTS)[]) {
      expect(PAYMENTS[id].reduce((s, p) => s + p.amount, 0), id).toBe(t.lines[id].spent);
    }
    expect(SEGMENTS.reduce((s, x) => s + x.amount, 0)).toBe(TOTALS.collected);
    expect(TOTALS.collected - TOTALS.spent).toBe(t.balance);
  });
  it("only payments over the cap went out with signatures", () => {
    for (const list of Object.values(PAYMENTS)) for (const p of list) expect(p.rule === "signed", `${p.vendor} ${p.amount}`).toBe(p.amount > CAPS.perPayment);
  });
});

describe("live ledger", async () => {
  const { ledgerAt, LIVE, TOTALS } = await import("./transparency-data");
  it("starts at the year so far and keeps every peso accounted for as movements land", () => {
    expect(ledgerAt(0).totals).toMatchObject({ collected: TOTALS.collected, spent: TOTALS.spent, balance: TOTALS.balance });
    for (let n = 0; n <= LIVE.length; n++) {
      const v = ledgerAt(n);
      expect(v.segments.reduce((s, x) => s + x.amount, 0), `n=${n}`).toBe(v.totals.collected);
      expect(v.totals.collected - v.totals.spent).toBe(v.totals.balance);
    }
    const end = ledgerAt(LIVE.length);
    expect(end.payments.mantenimiento[0].vendor).toBe("Ferretería El Tornillo");
    expect(end.feed[0]).toBe(LIVE.at(-1));
  });
});
