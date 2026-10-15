// Shared database schema. The contract is the source of truth for money; these tables hold
// people, files, the event index and the agent's own bookkeeping.
// Amounts are wARS base units (18 decimals) stored as numeric strings.
import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** The one cooperadora this instance serves. Single row, id = 1. */
export const cooperadora = pgTable("cooperadora", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  school: text("school").notNull(),
  cuit: bigint("cuit", { mode: "bigint" }).notNull(),
  ruce: text("ruce"),
  chainId: integer("chain_id").notNull(),
  treasuryAddress: text("treasury_address").notNull(),
  boxFactoryAddress: text("box_factory_address").notNull(),
  configHash: text("config_hash").notNull(),
  createdAt: createdAt(),
});

/** Every human: socio, comisión, revisor, asesor, proveedor. Identified by phone. No student data. */
export const persons = pgTable("persons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(), // E.164, e.g. +5493884000000
  telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).unique(),
  telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }),
  /** Any of: socio, presidente, tesorero, secretario, revisor, asesor, proveedor. */
  roles: text("roles").array().notNull().default([]),
  kind: text("kind"), // padre | docente | exalumno | otro
  safeAddress: text("safe_address"), // passkey Safe, for signers and vendors
  createdAt: createdAt(),
});

/** WebAuthn credentials that own a person's Safe. */
export const passkeys = pgTable("passkeys", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => persons.id),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(), // hex, uncompressed P-256
  safeAddress: text("safe_address").notNull(),
  createdAt: createdAt(),
});

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").references(() => persons.id),
  legalName: text("legal_name").notNull(),
  cuit: bigint("cuit", { mode: "bigint" }).notNull().unique(),
  address: text("address").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

/** Human labels for budget lines. Amounts live on chain (mirrored by the indexer in budgetIndex). */
export const budgetLines = pgTable("budget_lines", {
  lineId: text("line_id").primaryKey(), // bytes32 hex = keccak256(slug)
  slug: text("slug").notNull().unique(), // materiales, mantenimiento, comedor, eventos, imprevistos, gastos-operativos
  name: text("name").notNull(),
});

export const budgetIndex = pgTable("budget_index", {
  lineId: text("line_id").primaryKey(),
  allocated: amount("allocated").notNull(),
  spent: amount("spent").notNull(),
  periodEnd: bigint("period_end", { mode: "number" }).notNull(),
  updatedAt: updatedAt(),
});

/** One per "Aportar" tap: a one-time deposit box. ref is random; the person link never goes on chain. */
export const contributionIntents = pgTable("contribution_intents", {
  ref: text("ref").primaryKey(), // bytes32 hex
  personId: integer("person_id").notNull().references(() => persons.id),
  suggestedAmount: amount("suggested_amount"),
  boxAddress: text("box_address").notNull().unique(),
  status: text("status").notNull().default("open"), // open | swept | expired
  sweptTxHash: text("swept_tx_hash"),
  createdAt: createdAt(),
});

/** Income. Money kinds come from chain events; especie/trabajo are entered by hand. */
export const contributions = pgTable(
  "contributions",
  {
    id: serial("id").primaryKey(),
    ref: text("ref"), // null for unidentified transfers and manual entries
    personId: integer("person_id").references(() => persons.id),
    amount: amount("amount").notNull(),
    kind: text("kind").notNull().default("dinero"), // dinero | especie | trabajo
    memo: text("memo"),
    txHash: text("tx_hash"),
    logIndex: integer("log_index"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receiptSentAt: timestamp("receipt_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contributions_tx_log").on(t.txHash, t.logIndex)],
);

/**
 * Invoice lifecycle:
 * recibida → leida → validada | rechazada | revision → propuesta → pagada | pendiente → aprobada → pagada | cancelada
 */
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    uploaderPersonId: integer("uploader_person_id").notNull().references(() => persons.id),
    vendorId: integer("vendor_id").references(() => vendors.id),
    status: text("status").notNull().default("recibida"),
    statusReason: text("status_reason"), // human-readable reason for rechazada / revision
    source: text("source"), // qr | llm | qr+llm
    cuit: bigint("cuit", { mode: "bigint" }),
    tipo: integer("tipo"),
    ptoVta: integer("pto_vta"),
    nro: bigint("nro", { mode: "bigint" }),
    amount: amount("amount"), // wARS base units
    amountPesos: text("amount_pesos"), // as printed, e.g. "12500.00"
    issuedOn: text("issued_on"), // YYYY-MM-DD
    receptorDocTipo: integer("receptor_doc_tipo"),
    receptorDocNro: bigint("receptor_doc_nro", { mode: "bigint" }),
    cae: text("cae"),
    extracted: jsonb("extracted"), // raw QR payload and/or LLM output
    fileUrl: text("file_url").notNull(),
    fileHash: text("file_hash").notNull(), // keccak256 of the file bytes
    lineId: text("line_id"),
    invoiceId: text("invoice_id"), // bytes32 hex, set once fiscal fields are known
    paymentId: bigint("payment_id", { mode: "bigint" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("invoices_invoice_id").on(t.invoiceId)],
);

/** Index of on-chain payments. */
export const payments = pgTable("payments", {
  paymentId: bigint("payment_id", { mode: "bigint" }).primaryKey(),
  vendor: text("vendor").notNull(),
  amount: amount("amount").notNull(),
  lineId: text("line_id").notNull(),
  invoiceId: text("invoice_id").notNull(),
  fileHash: text("file_hash").notNull(),
  status: text("status").notNull(), // pending | executed | rejected
  rule: text("rule"), // auto | signers
  overBudget: boolean("over_budget").notNull().default(false),
  budgetExpired: boolean("budget_expired").notNull().default(false),
  approvals: integer("approvals").notNull().default(0),
  proposedTxHash: text("proposed_tx_hash"),
  executedTxHash: text("executed_tx_hash"),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Index of configuration proposals. reasonText is the human motive (its hash is on chain for moves). */
export const proposals = pgTable("proposals", {
  proposalId: bigint("proposal_id", { mode: "bigint" }).primaryKey(),
  kind: text("kind").notNull(),
  data: text("data").notNull(), // hex
  decoded: jsonb("decoded"),
  reasonText: text("reason_text"),
  proposer: text("proposer").notNull(),
  approvals: integer("approvals").notNull().default(0),
  status: text("status").notNull().default("open"), // open | executed
  createdTxHash: text("created_tx_hash"),
  executedTxHash: text("executed_tx_hash"),
  updatedAt: updatedAt(),
});

export const approvals = pgTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    target: text("target").notNull(), // payment | proposal
    targetId: bigint("target_id", { mode: "bigint" }).notNull(),
    signer: text("signer").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("approvals_tx_log").on(t.txHash, t.logIndex)],
);

/** Every decoded log the indexer saw, for the panel's timeline and audits. */
export const chainEvents = pgTable(
  "chain_events",
  {
    id: serial("id").primaryKey(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    address: text("address").notNull(),
    eventName: text("event_name").notNull(),
    args: jsonb("args").notNull(), // bigint values serialized as decimal strings
  },
  (t) => [uniqueIndex("chain_events_tx_log").on(t.txHash, t.logIndex)],
);

export const indexerCursor = pgTable("indexer_cursor", {
  key: text("key").primaryKey(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  updatedAt: updatedAt(),
});

/**
 * Agent transactions with an idempotency key (e.g. "propose:invoice:42", "sweep:<ref>").
 * A row in `sending` with a txHash is never resent blindly: wait for its receipt.
 */
export const agentTxs = pgTable("agent_txs", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  kind: text("kind").notNull(), // propose | sweep | register | other
  status: text("status").notNull(), // sending | mined | reverted | failed
  txHash: text("tx_hash"),
  nonce: integer("nonce"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Lease locks so two ticks never run the same work. */
export const locks = pgTable("locks", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Monthly rendición. borrador → revisada → publicada. */
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  period: text("period").notNull().unique(), // YYYY-MM
  status: text("status").notNull().default("borrador"),
  data: jsonb("data").notNull(), // the full computed report
  pdfUrl: text("pdf_url"),
  reviewedByPersonId: integer("reviewed_by_person_id").references(() => persons.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Per-chat conversation state for the Telegram bot. */
export const chatState = pgTable("chat_state", {
  chatId: bigint("chat_id", { mode: "bigint" }).primaryKey(),
  state: jsonb("state").notNull(),
  updatedAt: updatedAt(),
});

/** One-time links sent over Telegram to open the signing page in the phone's browser. */
export const signLinks = pgTable("sign_links", {
  token: text("token").primaryKey(),
  personId: integer("person_id").notNull().references(() => persons.id),
  purpose: text("purpose").notNull(), // enroll | sign | vendor
  target: jsonb("target"), // e.g. { paymentId: "3" } or { proposalId: "1" }
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});
