// Outgoing messages. Everything the agent says to a known person goes through a Notifier, so tests
// can capture it and the orchestrator never talks to Telegram directly.
import { eq } from "drizzle-orm";
import type { Api } from "grammy";
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from "grammy/types";
import type { Db } from "@/db";
import { persons } from "@/db/schema";

/** An inline button: opens a URL or sends callback data back to the bot (max 64 bytes). */
export type InlineButton = { text: string; url: string } | { text: string; data: string };

/** Inline buttons (rows) under the message, or the persistent menu keyboard. */
export type Buttons = InlineButton[][] | { menu: string[][] };

export type Notifier = (personId: number, text: string, buttons?: Buttons) => Promise<void>;

export function toReplyMarkup(buttons?: Buttons): InlineKeyboardMarkup | ReplyKeyboardMarkup | undefined {
  if (!buttons) return undefined;
  if ("menu" in buttons) {
    return {
      keyboard: buttons.menu.map((row) => row.map((text) => ({ text }))),
      resize_keyboard: true,
      is_persistent: true,
    };
  }
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ("url" in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })),
    ),
  };
}

/** Sends to the person's private chat. A person who never opened the bot is skipped. */
export function telegramNotifier(db: Db, api: Api): Notifier {
  return async (personId, text, buttons) => {
    const [person] = await db
      .select({ chatId: persons.telegramChatId })
      .from(persons)
      .where(eq(persons.id, personId));
    if (!person?.chatId) {
      console.warn(`notify: person ${personId} has no Telegram chat yet`);
      return;
    }
    await api.sendMessage(Number(person.chatId), text, {
      reply_markup: toReplyMarkup(buttons),
      link_preview_options: { is_disabled: true },
    });
  };
}
