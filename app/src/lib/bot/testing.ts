// Test helpers for the bot: a grammY Bot that never touches the network, and update builders.
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { Assistant, AssistantInput } from "./assistant";
import { createBot } from "./bot";
import type { AgentDeps } from "@/lib/orchestrator/deps";

export const BOT_INFO = {
  id: 42,
  is_bot: true,
  first_name: "Cooperadora",
  username: "cooperadora_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
} as unknown as UserFromGetMe;

export type ApiCall = { method: string; payload: Record<string, unknown> };

export function testBot(deps: AgentDeps, opts: { reply?: string; files?: Map<string, Uint8Array> } = {}) {
  const calls: ApiCall[] = [];
  const asked: AssistantInput[] = [];
  const assistant: Assistant = async (input) => {
    asked.push(input);
    return opts.reply ?? "Respuesta de prueba.";
  };
  const bot: Bot = createBot({
    token: "123:test",
    botInfo: BOT_INFO,
    deps: {
      ...deps,
      assistant,
      downloadFile: async (fileId) => {
        const bytes = opts.files?.get(fileId);
        if (!bytes) throw new Error(`no test file ${fileId}`);
        return bytes;
      },
    },
  });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const p = payload as { chat_id?: number; text?: string };
    const result = method === "sendMessage" ? { message_id: calls.length, date: 0, chat: { id: p.chat_id, type: "private" }, text: p.text } : true;
    return { ok: true, result } as never;
  });
  return { bot, calls, asked };
}

let nextId = 1;
const chatOf = (userId: number) => ({ id: userId, type: "private" as const, first_name: "Test" });
const userOf = (userId: number) => ({ id: userId, is_bot: false, first_name: "Test" });

function message(userId: number, extra: Record<string, unknown>): Update {
  return {
    update_id: nextId++,
    message: { message_id: nextId++, date: 1_760_000_000, chat: chatOf(userId), from: userOf(userId), ...extra },
  } as unknown as Update;
}

export const updates = {
  text: (userId: number, text: string) => message(userId, { text }),
  contact: (userId: number, phone: string, contactUserId = userId) =>
    message(userId, { contact: { phone_number: phone, first_name: "Test", user_id: contactUserId } }),
  document: (userId: number, fileId: string, mime = "application/pdf") =>
    message(userId, { document: { file_id: fileId, file_unique_id: fileId, mime_type: mime, file_size: 1000 } }),
  callback: (userId: number, data: string): Update =>
    ({
      update_id: nextId++,
      callback_query: {
        id: String(nextId++),
        from: userOf(userId),
        chat_instance: "x",
        data,
        message: { message_id: nextId++, date: 1_760_000_000, chat: chatOf(userId), text: "..." },
      },
    }) as unknown as Update,
};
