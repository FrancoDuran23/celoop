// Who is who. Roles are per cooperative (memberships); signers are the comisión plus the revisor.
// persons.roles is the demo's original padrón: it only counts for the demo cooperative while that
// one has no memberships yet (old databases and tests), and for the platform operator.
import { and, arrayOverlaps, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { memberships, persons } from "@/db/schema";
import { DEMO_COOPERADORA_ID, scopeId } from "@/lib/tenant";

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

/** Whether a cooperative still runs on the legacy padrón (persons.roles) instead of memberships. */
export async function usesLegacyRoles(db: Db, cooperadoraId: number): Promise<boolean> {
  if (cooperadoraId !== DEMO_COOPERADORA_ID) return false;
  const [any] = await db.select({ id: memberships.personId }).from(memberships).where(eq(memberships.cooperadoraId, cooperadoraId)).limit(1);
  return !any;
}

/**
 * Everyone in one cooperative (the demo when unset), each with the roles they hold there.
 * The platform operator is not a member of anything: see personsWithRoles.
 */
export async function membersOf(db: Db, cooperadoraId?: number): Promise<Person[]> {
  const coop = scopeId(cooperadoraId);
  if (await usesLegacyRoles(db, coop)) return db.select().from(persons).orderBy(persons.id);
  const rows = await db
    .select({ person: persons, roles: memberships.roles })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(eq(memberships.cooperadoraId, coop))
    .orderBy(persons.id);
  return rows.map((r) => ({ ...r.person, roles: r.roles }));
}

/** People with any of `roles` in one cooperative (the demo when unset), with their roles there. */
export async function personsWithRoles(db: Db, roles: readonly string[], cooperadoraId?: number): Promise<Person[]> {
  // The operator runs the platform, not one cooperative: alerts reach them from every one.
  if (roles.length === 1 && roles[0] === OPERATOR_ROLE) {
    return db.select().from(persons).where(arrayOverlaps(persons.roles, [OPERATOR_ROLE])).orderBy(persons.id);
  }
  return (await membersOf(db, cooperadoraId)).filter((p) => has(p, roles));
}

/** Gives a person a role in one cooperative. A no-op for the demo while it still runs on persons.roles. */
export async function grantRole(db: Db, personId: number, cooperadoraId: number, role: string): Promise<void> {
  if (await usesLegacyRoles(db, cooperadoraId)) return;
  const [m] = await db
    .select({ roles: memberships.roles })
    .from(memberships)
    .where(and(eq(memberships.personId, personId), eq(memberships.cooperadoraId, cooperadoraId)));
  if (m?.roles.includes(role)) return;
  const roles = [...new Set([...(m?.roles ?? []), role])];
  await db
    .insert(memberships)
    .values({ personId, cooperadoraId, roles })
    .onConflictDoUpdate({ target: [memberships.personId, memberships.cooperadoraId], set: { roles } });
}

/**
 * The person with the roles they hold in one cooperative (empty when they are not in it).
 * Use it to authorize anything that touches that cooperative's invoices, reports or money.
 */
export async function personInCooperadora(db: Db, personId: number, cooperadoraId?: number): Promise<Person | undefined> {
  const person = await personById(db, personId);
  if (!person) return undefined;
  const coop = scopeId(cooperadoraId);
  const [m] = await db
    .select({ roles: memberships.roles })
    .from(memberships)
    .where(and(eq(memberships.personId, personId), eq(memberships.cooperadoraId, coop)));
  if (m) return { ...person, roles: m.roles };
  if (await usesLegacyRoles(db, coop)) return person;
  return { ...person, roles: [] };
}

export const firstName = (p: Pick<Person, "name">) => p.name.trim().split(/\s+/)[0] ?? p.name;
