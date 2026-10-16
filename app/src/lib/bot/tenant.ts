// One Telegram account, possibly several cooperatives. Roles for the menu come from the
// membership; persons.roles only counts for the demo while it has no memberships yet.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { cooperadora, memberships } from "@/db/schema";
import { getSelectedCooperadora } from "@/lib/orchestrator/chat-state";
import { usesLegacyRoles, type Person } from "@/lib/orchestrator/people";
import { cooperadoraById, DEMO_COOPERADORA_ID } from "@/lib/tenant";

export type CoopChoice = { id: number; name: string; school: string; roles: string[] };

export async function choicesFor(db: Db, person: Person): Promise<CoopChoice[]> {
  const rows = await db
    .select({
      id: cooperadora.id,
      name: cooperadora.name,
      school: cooperadora.school,
      roles: memberships.roles,
      status: cooperadora.status,
    })
    .from(memberships)
    .innerJoin(cooperadora, eq(cooperadora.id, memberships.cooperadoraId))
    .where(eq(memberships.personId, person.id));
  if (rows.length > 0) {
    return rows
      .filter((r) => r.status === "active")
      .map((r) => ({ id: r.id, name: r.name, school: r.school, roles: r.roles }));
  }
  // No memberships at all: the demo's original padrón, while the demo still runs on it.
  const demo = await cooperadoraById(db, DEMO_COOPERADORA_ID);
  if (!demo || demo.status !== "active" || !(await usesLegacyRoles(db, demo.id))) return [];
  return [{ id: demo.id, name: demo.name, school: demo.school, roles: person.roles }];
}

export function withRoles(person: Person, roles: string[]): Person {
  return roles === person.roles ? person : { ...person, roles };
}

/**
 * The cooperative this chat is acting for, a list when the person has to pick, or `none` when they
 * are not in any active cooperative (for example, theirs is still being set up).
 */
export async function resolveChatCooperadora(
  db: Db,
  person: Person,
  chatId: bigint,
): Promise<{ person: Person; cooperadoraId: number } | { choose: CoopChoice[] } | { none: true }> {
  const choices = await choicesFor(db, person);
  if (choices.length === 0) return { none: true };
  if (choices.length === 1) return { person: withRoles(person, choices[0].roles), cooperadoraId: choices[0].id };
  const selected = await getSelectedCooperadora(db, chatId);
  const match = choices.find((c) => c.id === selected);
  if (match) return { person: withRoles(person, match.roles), cooperadoraId: match.id };
  return { choose: choices };
}
