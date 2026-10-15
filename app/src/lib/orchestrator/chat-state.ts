// Per-chat state in chat_state.state (jsonb):
//   { flow?: Flow, notices?: string[] }
// `flow` is what the bot is waiting for in that chat. `notices` are the keys of one-time messages
// already sent there (budget alerts, review links, operator alerts), so the tick never repeats one.
// Every write is a single atomic statement, so the bot and the tick can touch the same row safely.
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { chatState, persons } from "@/db/schema";

export type Flow = { kind: "amount" };

export async function getFlow(db: Db, chatId: bigint): Promise<Flow | null> {
  const [row] = await db.select({ state: chatState.state }).from(chatState).where(eq(chatState.chatId, chatId));
  const flow = (row?.state as { flow?: Flow } | undefined)?.flow;
  return flow && typeof flow === "object" && flow.kind === "amount" ? flow : null;
}

export async function setFlow(db: Db, chatId: bigint, flow: Flow | null): Promise<void> {
  if (flow) {
    const value = JSON.stringify(flow);
    await db
      .insert(chatState)
      .values({ chatId, state: { flow }, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: chatState.chatId,
        set: { state: sql`jsonb_set(${chatState.state}, '{flow}', ${value}::jsonb)`, updatedAt: new Date() },
      });
  } else {
    await db
      .update(chatState)
      .set({ state: sql`${chatState.state} - 'flow'`, updatedAt: new Date() })
      .where(eq(chatState.chatId, chatId));
  }
}

/** Records `key` as sent in this chat. True only for the first caller. */
export async function claimNotice(db: Db, chatId: bigint, key: string): Promise<boolean> {
  const one = JSON.stringify([key]);
  const rows = await db
    .insert(chatState)
    .values({ chatId, state: { notices: [key] }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: chatState.chatId,
      set: {
        state: sql`jsonb_set(${chatState.state}, '{notices}', coalesce(${chatState.state}->'notices', '[]'::jsonb) || ${one}::jsonb)`,
        updatedAt: new Date(),
      },
      setWhere: sql`not coalesce(${chatState.state}->'notices', '[]'::jsonb) @> ${one}::jsonb`,
    })
    .returning({ chatId: chatState.chatId });
  return rows.length > 0;
}

/** Undoes a claim whose message could not be delivered, so the next tick tries again. */
export async function releaseNotice(db: Db, chatId: bigint, key: string): Promise<void> {
  await db
    .update(chatState)
    .set({
      state: sql`jsonb_set(${chatState.state}, '{notices}', coalesce((select jsonb_agg(e) from jsonb_array_elements(${chatState.state}->'notices') e where e <> to_jsonb(${key}::text)), '[]'::jsonb))`,
      updatedAt: new Date(),
    })
    .where(eq(chatState.chatId, chatId));
}

/** Chat id of a person, or null if they never opened the bot. */
export async function chatIdOf(db: Db, personId: number): Promise<bigint | null> {
  const [p] = await db.select({ chatId: persons.telegramChatId }).from(persons).where(eq(persons.id, personId));
  return p?.chatId ?? null;
}
