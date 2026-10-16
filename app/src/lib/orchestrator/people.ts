// Who is who. Roles live in persons.roles; signers are the comisión plus the revisor.
import { and, arrayOverlaps, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { memberships, persons } from "@/db/schema";

export type Person = typeof persons.$inferSelect;

export const COMMISSION_ROLES = ["presidente", "tesorero", "secretario"] as const;
export const REVIEWER_ROLE = "revisor";
export const SIGNER_ROLES = [...COMMISSION_ROLES, REVIEWER_ROLE] as const;
export const VENDOR_ROLE = "proveedor";
/** Technical operator: receives alerts about stuck agent transactions. */
export const OPERATOR_ROLE = "operador";

const has = (p: Pick<Person, "roles">, roles: readonly string[]) => p.roles.some((r) => roles.includes(r));

export const isCommission = (p: Pick<Person, "roles">) => has(p, COMMISSION_ROLES);
export const isReviewer = (p: Pick<Person, "roles">) => p.roles.includes(REVIEWER_ROLE);
export const isSigner = (p: Pick<Person, "roles">) => has(p, SIGNER_ROLES);
export const isVendor = (p: Pick<Person, "roles">) => p.roles.includes(VENDOR_ROLE);
/** Comisión and revisor can upload invoices and see pending payments. */
export const canManageInvoices = isSigner;
/** Everyone in the padrón except a pure vendor gets the socio menu. */
export const isMember = (p: Pick<Person, "roles">) => p.roles.length === 0 || p.roles.some((r) => r !== VENDOR_ROLE);

export async function personById(db: Db, id: number): Promise<Person | undefined> {
  const [p] = await db.select().from(persons).where(eq(persons.id, id));
  return p;
}

export async function personsWithRoles(db: Db, roles: readonly string[], cooperadoraId?: number): Promise<Person[]> {
  if (cooperadoraId != null) {
    const members = await db
      .select({ personId: memberships.personId, roles: memberships.roles })
      .from(memberships)
      .where(eq(memberships.cooperadoraId, cooperadoraId));
    if (members.length > 0) {
      const ids = members.filter((m) => m.roles.some((r) => roles.includes(r))).map((m) => m.personId);
      if (ids.length === 0) return [];
      return db.select().from(persons).where(inArray(persons.id, ids)).orderBy(persons.id);
    }
  }
  return db
    .select()
    .from(persons)
    .where(and(arrayOverlaps(persons.roles, [...roles])))
    .orderBy(persons.id);
}

export const firstName = (p: Pick<Person, "name">) => p.name.trim().split(/\s+/)[0] ?? p.name;
