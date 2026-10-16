// One Telegram account, possibly several cooperatives. Roles for the menu come from the
// membership when there is one, otherwise from persons.roles (the demo padrón).
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { cooperadora, memberships } from "@/db/schema";
import { getSelectedCooperadora } from "@/lib/orchestrator/chat-state";
import type { Person } from "@/lib/orchestrator/people";
import { activeCooperadoras } from "@/lib/tenant";

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
  const coops = await activeCooperadoras(db);
  if (coops.length === 1) {
    return [{ id: coops[0].id, name: coops[0].name, school: coops[0].school, roles: person.roles }];
  }
  return [];
}

export function withRoles(person: Person, roles: string[]): Person {
  return roles === person.roles ? person : { ...person, roles };
}

/** The cooperative this chat is acting for, or a list when the person has to pick. */
export async function resolveChatCooperadora(
  db: Db,
  person: Person,
  chatId: bigint,
): Promise<{ person: Person; cooperadoraId: number } | { choose: CoopChoice[] }> {
  const choices = await choicesFor(db, person);
  if (choices.length === 0) return { person, cooperadoraId: 1 };
  if (choices.length === 1) return { person: withRoles(person, choices[0].roles), cooperadoraId: choices[0].id };
  const selected = await getSelectedCooperadora(db, chatId);
  const match = choices.find((c) => c.id === selected);
  if (match) return { person: withRoles(person, match.roles), cooperadoraId: match.id };
  return { choose: choices };
}
