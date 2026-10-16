// The Telegram bot (grammY, webhook mode). Identifies people by the phone they share, shows a
// menu by role and hands real work to the orchestrator. Messages to known people go through
// live().notify; only the "share your contact" prompt (before we know who it is) uses ctx.reply.
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, inArray } from "drizzle-orm";
import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { invoices, persons, reports } from "@/db/schema";
import { getFlow, setFlow, setSelectedCooperadora } from "@/lib/orchestrator/chat-state";
import { createContributionIntent, SUGGESTED_AMOUNTS } from "@/lib/orchestrator/contribute";
import { forCooperadora, type AgentDeps } from "@/lib/orchestrator/deps";
import { formatPesos, parseAmount, pesos } from "@/lib/orchestrator/format";
import { chooseLine, notifySignerWithoutPasskey, processInvoice } from "@/lib/orchestrator/invoice";
import { enrollUrl, paymentSignUrl, proposeUrl, reviewUrl, vendorUrl } from "@/lib/orchestrator/links";
import {
  canManageInvoices,
  firstName,
  isSigner,
  isVendor,
  personInCooperadora,
  type Person,
} from "@/lib/orchestrator/people";
import { listForReview, resolveReview } from "@/lib/orchestrator/review";
import { periodLabelEs } from "@/lib/report/format";
import { cooperadoraById, scopeId } from "@/lib/tenant";
import type { Assistant } from "./assistant";
import { MENU, matchMenu, menuActions, menuKeyboard, type MenuAction } from "./menu";
import type { InlineButton } from "./notify";
import { phoneCandidates } from "./phone";
import { resolveChatCooperadora, type CoopChoice } from "./tenant";
import { myContributions, pendingPayments, spendingSummary, treasuryContext } from "./views";

export type BotDeps = AgentDeps & {
  assistant: Assistant;
  /** Bytes of a Telegram file. Defaults to getFile + the Bot API file URL. */
  downloadFile?: (fileId: string) => Promise<Uint8Array>;
};

export const CONTACT_BUTTON = "Compartir mi contacto";
const MAX_FILE_BYTES = 20 * 1024 * 1024; // Bot API download limit
const INVOICE_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export const TEXT = {
  askContact:
    "¡Hola! Soy el asistente de la cooperadora. Para saber quién sos, tocá el botón «Compartir mi contacto». Solo uso tu teléfono para buscarte en el padrón.",
  notFound: "No te encuentro en el padrón; pedile a la comisión que te agregue.",
  ownContact: "Necesito tu propio contacto: tocá el botón «Compartir mi contacto» de abajo.",
  notAllowed: "Esa opción no está disponible para vos.",
  sorry: "Uy, tuve un problema y no pude terminar. Probá de nuevo en un rato.",
  noActiveCoop: "Todavía no estás en ninguna cooperadora activa. Si te sumaron a una nueva, te aviso apenas la den de alta.",
};

export function createBot(opts: { token: string; botInfo?: UserFromGetMe; deps: BotDeps }): Bot {
  const bot = new Bot(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  const deps = opts.deps;
  const { db } = deps;
  // Each update runs with the deps of the cooperative the chat is working on: its id for every
  // query and its own treasury for every chain read and send.
  const coopAls = new AsyncLocalStorage<BotDeps>();
  const live = (): BotDeps => coopAls.getStore() ?? deps;
  async function inCoop<T>(cooperadoraId: number, fn: () => Promise<T>): Promise<T> {
    const row = await cooperadoraById(db, cooperadoraId);
    const scoped = row ? forCooperadora(deps, row) : { ...deps, cooperadoraId };
    return coopAls.run(scoped, fn);
  }
  const chooser = (choices: CoopChoice[]) =>
    new InlineKeyboard(choices.map((c) => [{ text: `${c.name} · ${c.school}`, callback_data: `coop:${c.id}` }]));
  const download =
    live().downloadFile ??
    (async (fileId: string) => {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) throw new Error("Telegram returned no file_path");
      const res = await fetch(`https://api.telegram.org/file/bot${opts.token}/${file.file_path}`);
      if (!res.ok) throw new Error(`Telegram file download: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });

  const askContact = (ctx: Context, text = TEXT.askContact) =>
    ctx.reply(text, { reply_markup: new Keyboard().requestContact(CONTACT_BUTTON).resized().oneTime() });

  async function findPerson(ctx: Context): Promise<Person | undefined> {
    if (!ctx.from) return undefined;
    const [p] = await db.select().from(persons).where(eq(persons.telegramUserId, BigInt(ctx.from.id)));
    if (p && ctx.chat && p.telegramChatId !== BigInt(ctx.chat.id)) {
      await db.update(persons).set({ telegramChatId: BigInt(ctx.chat.id) }).where(eq(persons.id, p.id));
      p.telegramChatId = BigInt(ctx.chat.id);
    }
    // Inside a cooperative, the person carries the roles they hold there.
    const scope = coopAls.getStore();
    if (p && scope?.cooperadoraId != null) return personInCooperadora(db, p.id, scope.cooperadoraId);
    return p;
  }

  /** The cooperative an invoice row belongs to, for buttons on messages about it. */
  async function invoiceCooperadora(invoiceRowId: number): Promise<number | undefined> {
    const [row] = await db.select({ cooperadoraId: invoices.cooperadoraId }).from(invoices).where(eq(invoices.id, invoiceRowId));
    return row?.cooperadoraId;
  }

  const sendMenu = (p: Person, text: string) => live().notify(p.id, text, menuKeyboard(p));

  function welcome(p: Person): string {
    const lines = [`¡Hola, ${firstName(p)}! Ya sé quién sos.`];
    const actions = menuActions(p);
    if (actions.includes("aportar")) {
      lines.push(
        "Desde acá podés aportar a la cooperadora (siempre voluntario, cualquier monto ayuda) y ver en qué se usa cada peso.",
      );
    }
    if (actions.includes("cargarFactura")) lines.push("Como sos de la comisión, también podés cargar facturas y ver los pagos pendientes.");
    if (actions.includes("misCobros")) lines.push("Con «Mis cobros» ves lo que te pagó la cooperadora y lo pasás a tu cuenta.");
    lines.push("Elegí una opción del menú.");
    return lines.join("\n");
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  // Private chats only; errors end with an apology instead of silence.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private") return;
    try {
      const picking = ctx.callbackQuery?.data?.startsWith("coop:");
      const person = picking ? undefined : await findPerson(ctx);
      if (person && ctx.chat) {
        const bound = await resolveChatCooperadora(db, person, BigInt(ctx.chat.id));
        if ("choose" in bound) {
          await ctx.reply("Pertenecés a más de una cooperadora. ¿Con cuál seguimos?", { reply_markup: chooser(bound.choose) });
          return;
        }
        if ("none" in bound) return void (await ctx.reply(TEXT.noActiveCoop));
        // A button on a message about an invoice acts on that invoice's cooperative, even if the
        // chat has moved on to another one since. The handlers check the person's roles there.
        const invoiceRow = /^(?:rev:(?:ok|no)|line):(\d+)/.exec(ctx.callbackQuery?.data ?? "")?.[1];
        const coopId = (invoiceRow && (await invoiceCooperadora(Number(invoiceRow)))) || bound.cooperadoraId;
        return await inCoop(coopId, () => next());
      }
      await next();
    } catch (e) {
      console.error(`bot: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      try {
        const p = await findPerson(ctx);
        if (p) await live().notify(p.id, TEXT.sorry);
        else await ctx.reply(TEXT.sorry);
      } catch {
        // nothing else to do
      }
    }
  });

  bot.on("message:contact", async (ctx) => {
    const contact = ctx.message.contact;
    // A contact card can be anyone's; only the request_contact button sends your own.
    if (contact.user_id !== ctx.from.id) return void (await askContact(ctx, TEXT.ownContact));
    const candidates = phoneCandidates(contact.phone_number);
    const [p] = candidates.length
      ? await db.select().from(persons).where(inArray(persons.phone, candidates))
      : [];
    if (!p) return void (await ctx.reply(TEXT.notFound, { reply_markup: { remove_keyboard: true } }));

    const userId = BigInt(ctx.from.id);
    // The Telegram account may have been linked to someone else before (e.g. a changed phone).
    await db.update(persons).set({ telegramUserId: null }).where(eq(persons.telegramUserId, userId));
    const [linked] = await db
      .update(persons)
      .set({ telegramUserId: userId, telegramChatId: BigInt(ctx.chat.id) })
      .where(eq(persons.id, p.id))
      .returning();
    const bound = await resolveChatCooperadora(db, linked, BigInt(ctx.chat.id));
    if ("choose" in bound) {
      await ctx.reply("Pertenecés a más de una cooperadora. ¿Con cuál seguimos?", {
        reply_markup: chooser(bound.choose),
      });
      return;
    }
    if ("none" in bound) return void (await ctx.reply(TEXT.noActiveCoop, { reply_markup: { remove_keyboard: true } }));
    await inCoop(bound.cooperadoraId, async () => {
      await sendMenu(bound.person, welcome(bound.person));
      if (isSigner(bound.person) && !bound.person.safeAddress) {
        const url = await enrollUrl(db, live().appUrl, linked.id, live().now(), bound.cooperadoraId);
        await live().notify(
          bound.person.id,
          "Como sos firmante, necesitás crear tu firma con la huella o la cara del teléfono. Es un minuto. Abrí el link en Chrome o Safari (no dentro de Telegram).",
          [[{ text: "Crear mi firma", url }]],
        );
      }
    });
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const pick = /^coop:(\d+)$/.exec(data);
    if (pick && ctx.chat) {
      await setSelectedCooperadora(db, BigInt(ctx.chat.id), Number(pick[1]));
      const person = await findPerson(ctx);
      await ctx.answerCallbackQuery();
      if (!person) return void (await askContact(ctx));
      const bound = await resolveChatCooperadora(db, person, BigInt(ctx.chat.id));
      if ("choose" in bound) {
        return void (await ctx.reply("Esa cooperadora no está en tu lista.", { reply_markup: chooser(bound.choose) }));
      }
      if ("none" in bound) return void (await ctx.reply(TEXT.noActiveCoop));
      return inCoop(bound.cooperadoraId, () => sendMenu(bound.person, welcome(bound.person)));
    }
    const p = await findPerson(ctx);
    if (!p) {
      await ctx.answerCallbackQuery();
      return void (await askContact(ctx));
    }
    const amount = /^amt:(\d+)$/.exec(data);
    if (amount) {
      await ctx.answerCallbackQuery();
      return startContribution(p, pesos(Number(amount[1])));
    }
    if (data === "amt:otro") {
      await ctx.answerCallbackQuery();
      if (ctx.chat) await setFlow(db, BigInt(ctx.chat.id), { kind: "amount" });
      return live().notify(p.id, "¿Cuánto querés aportar? Escribí el monto en pesos, por ejemplo 4500.");
    }
    const rev = /^rev:(ok|no):(\d+)$/.exec(data);
    if (rev) {
      await ctx.answerCallbackQuery();
      await resolveReview(live(), { personId: p.id, invoiceRowId: Number(rev[2]), decision: rev[1] === "ok" ? "seguir" : "rechazar" });
      return;
    }
    const line = /^line:(\d+):([a-z0-9-]+)$/.exec(data);
    if (line) {
      await ctx.answerCallbackQuery({ text: "Listo, preparo el pago." });
      await chooseLine(live(), { personId: p.id, invoiceRowId: Number(line[1]), slug: line[2] });
      return;
    }
    await ctx.answerCallbackQuery();
  });

  bot.on(["message:photo", "message:document"], async (ctx) => {
    const p = await findPerson(ctx);
    if (!p) return void (await askContact(ctx));
    if (!canManageInvoices(p)) {
      return live().notify(p.id, "Las facturas las carga la comisión. Si tenés una, pasásela a alguien de la comisión.");
    }
    const msg = ctx.message;
    let fileId: string;
    let mimeType: string;
    let size: number | undefined;
    if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1];
      fileId = largest.file_id;
      mimeType = "image/jpeg";
      size = largest.file_size;
    } else {
      const doc = msg.document!;
      fileId = doc.file_id;
      mimeType = doc.mime_type ?? "";
      size = doc.file_size;
    }
    if (!INVOICE_MIME.has(mimeType)) {
      return live().notify(p.id, "Mandame la factura en PDF o como foto (JPG o PNG).");
    }
    if (size !== undefined && size > MAX_FILE_BYTES) {
      return live().notify(p.id, "El archivo es muy pesado (más de 20 MB). Mandá el PDF original o una foto más liviana.");
    }
    await live().notify(p.id, "Recibí la factura. La estoy leyendo, dame unos segundos.");
    const bytes = await download(fileId);
    await processInvoice(live(), { uploaderPersonId: p.id, file: { bytes, mimeType } });
  });

  bot.on("message:text", async (ctx) => {
    const p = await findPerson(ctx);
    if (!p) return void (await askContact(ctx));
    const text = ctx.message.text.trim();
    const chatId = BigInt(ctx.chat.id);

    if (/^\/(start|menu)\b/i.test(text)) {
      await setFlow(db, chatId, null);
      return sendMenu(p, welcome(p));
    }
    const action = matchMenu(text);
    if (action) {
      await setFlow(db, chatId, null);
      return runAction(p, action);
    }
    if ((await getFlow(db, chatId))?.kind === "amount") {
      if (/^(cancelar|no|salir)$/i.test(text)) {
        await setFlow(db, chatId, null);
        return sendMenu(p, "Listo, lo dejamos para otro momento.");
      }
      const value = parseAmount(text);
      if (value === null) {
        return live().notify(p.id, "No entendí el monto. Escribilo en números, por ejemplo 4500, o «cancelar».");
      }
      await setFlow(db, chatId, null);
      return startContribution(p, value);
    }
    const reply = await live().assistant({
      text,
      context: await treasuryContext(live()),
      personName: p.name,
      menu: menuActions(p).map((a) => MENU[a]),
    });
    await live().notify(p.id, reply);
  });

  bot.on("message", async (ctx) => {
    const p = await findPerson(ctx);
    if (!p) return void (await askContact(ctx));
    await sendMenu(p, "Elegí una opción del menú.");
  });

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function startContribution(p: Person, amount: bigint) {
    const intent = await createContributionIntent(live(), { personId: p.id, amount });
    await live().notify(
      p.id,
      [
        `¡Gracias por sumar ${formatPesos(amount)}! Así funciona:`,
        "1. Tocá «Aportar con Ripio». Se abre Ripio con el monto y el destino de la cooperadora ya cargados; no los cambies.",
        "2. Ripio te pide tus datos (la primera vez) y te muestra a dónde transferir los pesos desde tu banco o billetera.",
        "3. Cuando llega tu transferencia, la plata entra a la cooperadora y te mando el recibo por acá.",
        "",
        "El link es solo para este aporte. Si otro día querés volver a aportar, pedime uno nuevo.",
      ].join("\n"),
      [[{ text: "Aportar con Ripio", url: intent.url }]],
    );
  }

  async function runAction(p: Person, action: MenuAction): Promise<void> {
    if (!menuActions(p).includes(action) && !(action === "crearFirma" && isSigner(p))) {
      return live().notify(p.id, TEXT.notAllowed);
    }
    switch (action) {
      case "aportar": {
        const buttons: InlineButton[][] = [
          SUGGESTED_AMOUNTS.map((n) => ({ text: formatPesos(pesos(n)).replace(/,00$/, ""), data: `amt:${n}` })),
          [{ text: "Otro monto", data: "amt:otro" }],
        ];
        return live().notify(
          p.id,
          "¿Cuánto querés aportar? El aporte es voluntario y cualquier monto ayuda. Elegí uno o escribí otro.",
          buttons,
        );
      }
      case "gastos":
        return live().notify(p.id, await spendingSummary(live()));
      case "misAportes":
        return live().notify(p.id, await myContributions(live(), p.id));
      case "cargarFactura":
        return live().notify(
          p.id,
          "Mandame la factura acá mismo: mejor el PDF original; si es foto, que se vea entero el código QR. Tiene que ser factura B o C a nombre de la cooperadora.",
        );
      case "pendientes": {
        const pending = await pendingPayments(live());
        if (pending.length === 0) return live().notify(p.id, "No hay pagos esperando firmas.");
        const lines = [`Hay ${pending.length} ${pending.length === 1 ? "pago esperando" : "pagos esperando"} firmas:`];
        const buttons: InlineButton[][] = [];
        for (const x of pending.slice(0, 5)) {
          lines.push(`• #${x.paymentId} · ${x.vendor} · ${formatPesos(x.amount)} · ${x.lineName} · ${x.approvals} de ${x.threshold} firmas`);
          if (isSigner(p) && p.safeAddress) {
            const url = await paymentSignUrl(db, live().appUrl, p.id, BigInt(x.paymentId), live().now(), live().cooperadoraId);
            buttons.push([{ text: `Revisar y firmar #${x.paymentId}`, url }]);
          }
        }
        if (buttons.length > 0) lines.push("", "Abrí los links en Chrome o Safari para firmar.");
        await live().notify(p.id, lines.join("\n"), buttons.length ? buttons : undefined);
        if (isSigner(p) && !p.safeAddress) await notifySignerWithoutPasskey(live(), p, "Para firmar estos pagos te falta crear tu firma.");
        return;
      }
      case "proponer": {
        if (!p.safeAddress) return notifySignerWithoutPasskey(live(), p, "Para proponer un cambio primero tenés que crear tu firma.");
        const url = await proposeUrl(db, live().appUrl, p.id, live().now(), live().cooperadoraId);
        return live().notify(
          p.id,
          "Desde este link podés proponer mover plata entre partidas (con el motivo, que queda público) o reanudar los pagos si están en pausa. El cambio se aplica cuando junta las firmas necesarias. Abrilo en Chrome o Safari.",
          [[{ text: "Proponer cambio", url }]],
        );
      }
      case "revisar": {
        const [draft] = await db
          .select()
          .from(reports)
          .where(and(eq(reports.cooperadoraId, scopeId(live().cooperadoraId)), eq(reports.status, "borrador")))
          .orderBy(reports.period);
        if (!draft) return live().notify(p.id, "No hay ninguna rendición esperando tu revisión.");
        const url = await reviewUrl(db, live().appUrl, p.id, draft.period, live().now(), live().cooperadoraId);
        return live().notify(
          p.id,
          `La rendición de ${periodLabelEs(draft.period)} está en borrador. Revisala y, si está bien, dale el visto bueno desde la página.`,
          [[{ text: "Revisar rendición", url }]],
        );
      }
      case "revisarFacturas":
        await listForReview(live(), p);
        return;
      case "crearFirma": {
        if (p.safeAddress) return live().notify(p.id, "Ya tenés tu firma creada.");
        return notifySignerWithoutPasskey(live(), p, "Vamos a crear tu firma.");
      }
      case "misCobros": {
        if (!isVendor(p)) return live().notify(p.id, TEXT.notAllowed);
        const url = await vendorUrl(db, live().appUrl, p.id, live().now(), live().cooperadoraId);
        return live().notify(
          p.id,
          "En tu página ves lo que te pagó la cooperadora y podés pasarlo a tu cuenta bancaria. Abrila en Chrome o Safari.",
          [[{ text: "Mis cobros", url }]],
        );
      }
    }
  }
  return bot;
}
