import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { agentTxs, budgetIndex, contributionIntents, contributions, cooperadora, persons, reports, signLinks } from "@/db/schema";
import { withLock } from "@/lib/locks";
import { createContributionIntent, ripioOnrampUrl } from "./contribute";
import { pesos } from "./format";
import { buttonUrls, LINE_MATERIALES, testAgent } from "./testing";
import { runTick, TICK_LOCK } from "./tick";

describe("contributions", () => {
  test("intent → deposit → sweep → one receipt", async () => {
    const t = await testAgent();
    t.chain.onSweep = (ref, amount, txHash) => t.indexer.contribution(ref, amount, txHash, t.clock.now);

    const intent = await createContributionIntent(t.deps, { personId: t.people.socia.id, amount: pesos(5000) });
    expect(intent.ref).toMatch(/^0x[0-9a-f]{64}$/);
    expect(intent.url).toBe(
      `https://ramp.ripio.com/?mode=onramp&country=AR&chain=42220&token=WARS&amount=5000&address=${intent.boxAddress}`,
    );
    const [row] = await t.db.select().from(contributionIntents);
    expect(row).toMatchObject({ ref: intent.ref, personId: t.people.socia.id, boxAddress: intent.boxAddress, status: "open" });

    // No money yet: nothing to sweep.
    await runTick(t.deps);
    expect(t.chain.sweeps).toHaveLength(0);

    await t.chain.deposit(intent.ref, pesos(5000));
    const summary = await runTick(t.deps);
    expect(summary).toMatchObject({ ok: true, errors: [] });
    expect(t.chain.sweeps).toEqual([{ key: `sweep:${intent.ref}:0:${pesos(5000)}`, ref: intent.ref, amount: pesos(5000) }]);
    // The indexer ran again after the sweep, so the receipt went out in the same tick.
    const receipts = t.tg.to(t.people.socia.id).filter((m) => m.text.startsWith("Recibimos tu aporte"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0].text).toMatch(/^Recibimos tu aporte de \$ 5\.000,00 el 14\/10\/2026\. ¡Gracias! Ver movimiento: https:\/\/celoscan\.io\/tx\/0x/);
    const [c] = await t.db.select().from(contributions);
    expect(c.receiptSentAt).not.toBeNull();
    expect((await t.db.select().from(contributionIntents))[0].status).toBe("swept");

    await runTick(t.deps);
    await runTick(t.deps);
    expect(t.chain.sweeps).toHaveLength(1);
    expect(t.tg.to(t.people.socia.id).filter((m) => m.text.startsWith("Recibimos tu aporte"))).toHaveLength(1);
  });

  test("a second deposit into the same box gets a fresh sweep key", async () => {
    const t = await testAgent();
    t.chain.onSweep = (ref, amount, txHash) => t.indexer.contribution(ref, amount, txHash, t.clock.now);
    const intent = await createContributionIntent(t.deps, { personId: t.people.socia.id, amount: pesos(3000) });
    await t.chain.deposit(intent.ref, pesos(3000));
    await runTick(t.deps);
    await t.chain.deposit(intent.ref, pesos(3000));
    await runTick(t.deps);
    expect(t.chain.sweeps.map((s) => s.key)).toEqual([
      `sweep:${intent.ref}:0:${pesos(3000)}`,
      `sweep:${intent.ref}:1:${pesos(3000)}`,
    ]);
    expect(t.tg.to(t.people.socia.id).filter((m) => m.text.startsWith("Recibimos tu aporte"))).toHaveLength(2);
  });

  test("an intent with no money after 7 days expires", async () => {
    const t = await testAgent();
    await createContributionIntent(t.deps, { personId: t.people.socia.id, amount: pesos(3000) });
    t.clock.now = new Date(t.clock.now.getTime() + 6 * 24 * 3600 * 1000);
    await runTick(t.deps);
    expect((await t.db.select().from(contributionIntents))[0].status).toBe("open");
    t.clock.now = new Date(t.clock.now.getTime() + 2 * 24 * 3600 * 1000);
    await runTick(t.deps);
    expect((await t.db.select().from(contributionIntents))[0].status).toBe("expired");
  });

  test("once a day, expired boxes from the last 90 days are checked and late deposits swept", async () => {
    const t = await testAgent();
    t.chain.onSweep = (ref, amount, txHash) => t.indexer.contribution(ref, amount, txHash, t.clock.now);
    const intent = await createContributionIntent(t.deps, { personId: t.people.socia.id, amount: pesos(3000) });
    t.clock.now = new Date(t.clock.now.getTime() + 8 * 24 * 3600 * 1000); // 2026-10-22
    await runTick(t.deps);
    expect((await t.db.select().from(contributionIntents))[0].status).toBe("expired");

    // A late deposit the same day waits for tomorrow's check.
    await t.chain.deposit(intent.ref, pesos(3000));
    t.clock.now = new Date(t.clock.now.getTime() + 60 * 60 * 1000);
    await runTick(t.deps);
    expect(t.chain.sweeps).toHaveLength(0);

    t.clock.now = new Date(t.clock.now.getTime() + 24 * 3600 * 1000);
    const r = await runTick(t.deps);
    expect("steps" in r && r.steps.expiredSweeps).toMatchObject({ ran: true, checked: 1, swept: 1 });
    expect(t.chain.sweeps.map((s) => s.key)).toEqual([`sweep:${intent.ref}:0:${pesos(3000)}`]);
    expect(t.tg.to(t.people.socia.id).filter((m) => m.text.startsWith("Recibimos tu aporte de $ 3.000,00"))).toHaveLength(1);
    expect((await t.db.select().from(contributionIntents))[0].status).toBe("swept");

    // Older than 90 days: no longer checked.
    const old = await createContributionIntent(t.deps, { personId: t.people.socia.id, amount: pesos(1000) });
    await t.db.update(contributionIntents).set({ status: "expired", createdAt: new Date(t.clock.now.getTime() - 91 * 24 * 3600 * 1000) }).where(eq(contributionIntents.ref, old.ref));
    await t.chain.deposit(old.ref, pesos(1000));
    t.clock.now = new Date(t.clock.now.getTime() + 24 * 3600 * 1000);
    await runTick(t.deps);
    expect(t.chain.sweeps).toHaveLength(1);
  });

  test("the sweep waits when another agent send holds the lock", async () => {
    const t = await testAgent();
    const intent = await createContributionIntent(t.deps, { personId: t.people.socia.id, amount: pesos(3000) });
    await t.chain.deposit(intent.ref, pesos(3000));
    await withLock(t.db, "agent-tx", 60_000, async () => {
      const r = await runTick(t.deps);
      expect("steps" in r && r.steps.sweeps).toMatchObject({ busy: 1, swept: 0 });
    });
    await runTick(t.deps);
    expect(t.chain.sweeps).toHaveLength(1);
  });

  test("the Ripio link carries cents when there are any", () => {
    expect(ripioOnrampUrl({ amount: pesos(4500) + pesos(1) / BigInt(2), address: "0x00000000000000000000000000000000000000ff" })).toContain("amount=4500.50");
  });
});

describe("month close", () => {
  test("the first tick of the month closes the previous one, once, and sends the revisor a review link", async () => {
    const t = await testAgent(new Date("2026-10-31T23:00:00Z")); // 20:00 in Argentina, still October
    await runTick(t.deps);
    expect(t.reports.closed).toEqual(["2026-09"]); // the catch-up for September
    t.reports.closed.splice(0);

    t.clock.now = new Date("2026-11-01T03:05:00Z"); // 00:05 on Nov 1 in Argentina
    await runTick(t.deps);
    await runTick(t.deps);
    expect(t.reports.closed).toEqual(["2026-10"]);
    const [row] = await t.db.select().from(reports).where(eq(reports.period, "2026-10"));
    expect(row.status).toBe("borrador");

    const msgs = t.tg.to(t.people.revisora.id).filter((m) => m.text.includes("rendición de octubre de 2026"));
    expect(msgs).toHaveLength(1);
    const [url] = buttonUrls(msgs[0].buttons);
    expect(url).toMatch(/^https:\/\/coop\.test\/rendicion\/2026-10\?token=/);
    const token = decodeURIComponent(new URL(url).searchParams.get("token")!);
    const [link] = await t.db.select().from(signLinks).where(eq(signLinks.token, token));
    expect(link).toMatchObject({ personId: t.people.revisora.id, purpose: "review", target: { period: "2026-10" } });
    const { checkReviewToken } = await import("@/lib/report/tokens");
    expect(await checkReviewToken(t.db, token, "2026-10", t.clock.now)).toMatchObject({ ok: true });
  });

  test("months before the cooperadora existed are not closed", async () => {
    const t = await testAgent(new Date("2026-01-15T15:00:00Z"));
    await t.db.update(cooperadora).set({ createdAt: new Date("2026-01-10T12:00:00Z") });
    await runTick(t.deps);
    expect(t.reports.closed).toEqual([]);
  });

  test("a reviewed report is published and announced once", async () => {
    const t = await testAgent(new Date("2026-11-03T15:00:00Z"));
    await t.db.insert(reports).values({ period: "2026-10", status: "revisada", data: {} });
    await runTick(t.deps);
    expect(t.reports.published).toEqual(["2026-10"]);
    const announced = t.tg.sent.filter((m) => m.text.startsWith("Ya está publicada la rendición de octubre de 2026"));
    // presidente, tesorera, secretario, revisora
    expect(announced.map((m) => m.personId).sort()).toEqual(
      [t.people.presidente.id, t.people.tesorera.id, t.people.secretario.id, t.people.revisora.id].sort(),
    );
  });
});

describe("budget alerts", () => {
  test("a line past 80% is announced to the comisión once per line and period", async () => {
    const t = await testAgent();
    await runTick(t.deps);
    expect(t.tg.sent.filter((m) => m.text.startsWith("Aviso: la partida"))).toHaveLength(0);

    await t.db.update(budgetIndex).set({ spent: pesos(41000).toString() }).where(eq(budgetIndex.lineId, LINE_MATERIALES));
    await runTick(t.deps);
    await runTick(t.deps);
    const alerts = t.tg.sent.filter((m) => m.text.startsWith("Aviso: la partida Materiales"));
    expect(alerts.map((m) => m.personId).sort()).toEqual(
      [t.people.presidente.id, t.people.tesorera.id, t.people.secretario.id].sort(),
    );
    expect(alerts[0].text).toContain("ya usó el 82% de lo asignado (gastado $ 41.000,00 de $ 50.000,00). Quedan $ 9.000,00.");

    // A new budget period counts as a new alert.
    await t.db.update(budgetIndex).set({ periodEnd: 1_950_000_000 }).where(eq(budgetIndex.lineId, LINE_MATERIALES));
    await runTick(t.deps);
    expect(t.tg.sent.filter((m) => m.text.startsWith("Aviso: la partida Materiales"))).toHaveLength(6);
  });
});

describe("tick", () => {
  test("a transaction stuck in sending for more than 10 minutes alerts the operator once", async () => {
    const t = await testAgent();
    const [op] = await t.db
      .insert(persons)
      .values({ name: "Ope Rador", phone: "+5493880000099", roles: ["operador"], telegramUserId: BigInt(1099), telegramChatId: BigInt(1099) })
      .returning();
    await t.db.insert(agentTxs).values({
      key: "propose:invoice:9",
      kind: "propose",
      status: "sending",
      txHash: "0xabc",
      nonce: 7,
      updatedAt: new Date(t.clock.now.getTime() - 11 * 60 * 1000),
    });
    await t.db.insert(agentTxs).values({ key: "sweep:fresh", kind: "sweep", status: "sending", updatedAt: t.clock.now });
    await runTick(t.deps);
    await runTick(t.deps);
    const alerts = t.tg.to(op.id);
    expect(alerts).toHaveLength(1);
    // Only the operador role gets it.
    expect(t.tg.sent.filter((m) => m.text.includes("lleva más de 10 minutos"))).toHaveLength(1);
    expect(alerts[0].text).toContain('"propose:invoice:9" lleva más de 10 minutos');
  });

  test("two ticks never run at once", async () => {
    const t = await testAgent();
    await withLock(t.db, TICK_LOCK, 60_000, async () => {
      expect(await runTick(t.deps)).toEqual({ skipped: true });
    });
    expect(t.indexer.runs).toBe(0);
  });

  test("a failing step doesn't stop the others", async () => {
    const t = await testAgent();
    t.deps.indexer = async () => {
      throw new Error("rpc down");
    };
    await t.db.update(budgetIndex).set({ spent: pesos(45000).toString() }).where(eq(budgetIndex.lineId, LINE_MATERIALES));
    const r = await runTick(t.deps);
    expect(r).toMatchObject({ ok: true, errors: ["indexer: rpc down"] });
    expect(t.tg.sent.some((m) => m.text.startsWith("Aviso: la partida Materiales"))).toBe(true);
  });
});
