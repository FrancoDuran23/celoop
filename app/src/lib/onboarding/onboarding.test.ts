import { describe, expect, test } from "vitest";
import { createTestDb } from "@/db/testing";
import { memberships, persons } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createDraft, draftConfigHash, inviteSigner, parseCuit, saveRules, slugify } from "./index";

describe("signup helpers", () => {
  test("CUIT, slug and config hash", () => {
    expect(parseCuit("30-71234567-8")).toBe(BigInt("30712345678"));
    expect(parseCuit("123")).toBeNull();
    expect(slugify("Útiles y copias")).toBe("utiles-y-copias");
    const hash = draftConfigHash({
      threshold: 2,
      perTxCap: "1",
      vendorMonthlyCap: "2",
      lines: [
        { slug: "b", name: "B", allocated: "2", periodEnd: 1 },
        { slug: "a", name: "A", allocated: "1", periodEnd: 1 },
      ],
    });
    expect(hash).toBe(
      draftConfigHash({
        threshold: 2,
        perTxCap: "1",
        vendorMonthlyCap: "2",
        lines: [
          { slug: "a", name: "A", allocated: "1", periodEnd: 1 },
          { slug: "b", name: "B", allocated: "2", periodEnd: 1 },
        ],
      }),
    );
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("a draft is a new row, with its organizer and invited signer", async () => {
    const db = await createTestDb();
    const created = await createDraft(db, {
      name: "Cooperadora Norte",
      school: "Escuela 9",
      cuit: BigInt("30712345678"),
      organizerName: "Ana",
      organizerPhone: "+5493884000099",
    });
    expect(created.id).toBeGreaterThan(0);
    const invited = await inviteSigner(db, { id: created.id } as never, {
      name: "Beto",
      phone: "+5493884000098",
      role: "tesorero",
    });
    expect(invited.personId).toBeGreaterThan(0);
    await saveRules(db, { id: created.id } as never, {
      threshold: 1,
      perTxCap: "100",
      vendorMonthlyCap: "200",
      lines: [{ slug: "utiles", name: "Útiles", allocated: "100", periodEnd: 2_000_000_000 }],
    });
    const [member] = await db.select().from(memberships).where(eq(memberships.cooperadoraId, created.id));
    expect(member.roles).toContain("socio");
    const people = await db.select().from(persons);
    expect(people).toHaveLength(2);
  });
});
