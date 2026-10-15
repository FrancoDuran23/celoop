CREATE TABLE "agent_txs" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"nonce" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_txs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"target_id" bigint NOT NULL,
	"signer" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_index" (
	"line_id" text PRIMARY KEY NOT NULL,
	"allocated" numeric(78, 0) NOT NULL,
	"spent" numeric(78, 0) NOT NULL,
	"period_end" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"line_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "budget_lines_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"address" text NOT NULL,
	"event_name" text NOT NULL,
	"args" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_state" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_intents" (
	"ref" text PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"suggested_amount" numeric(78, 0),
	"box_address" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"swept_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_intents_box_address_unique" UNIQUE("box_address")
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" text,
	"person_id" integer,
	"amount" numeric(78, 0) NOT NULL,
	"kind" text DEFAULT 'dinero' NOT NULL,
	"memo" text,
	"tx_hash" text,
	"log_index" integer,
	"block_number" bigint,
	"occurred_at" timestamp with time zone NOT NULL,
	"receipt_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooperadora" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"school" text NOT NULL,
	"cuit" bigint NOT NULL,
	"ruce" text,
	"chain_id" integer NOT NULL,
	"treasury_address" text NOT NULL,
	"box_factory_address" text NOT NULL,
	"config_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_cursor" (
	"key" text PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploader_person_id" integer NOT NULL,
	"vendor_id" integer,
	"status" text DEFAULT 'recibida' NOT NULL,
	"status_reason" text,
	"source" text,
	"cuit" bigint,
	"tipo" integer,
	"pto_vta" integer,
	"nro" bigint,
	"amount" numeric(78, 0),
	"amount_pesos" text,
	"issued_on" text,
	"receptor_doc_tipo" integer,
	"receptor_doc_nro" bigint,
	"cae" text,
	"extracted" jsonb,
	"file_url" text NOT NULL,
	"file_hash" text NOT NULL,
	"line_id" text,
	"invoice_id" text,
	"payment_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locks" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"safe_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"payment_id" bigint PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"line_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" text NOT NULL,
	"rule" text,
	"over_budget" boolean DEFAULT false NOT NULL,
	"budget_expired" boolean DEFAULT false NOT NULL,
	"approvals" integer DEFAULT 0 NOT NULL,
	"proposed_tx_hash" text,
	"executed_tx_hash" text,
	"executed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"telegram_user_id" bigint,
	"telegram_chat_id" bigint,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"kind" text,
	"safe_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_phone_unique" UNIQUE("phone"),
	CONSTRAINT "persons_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"proposal_id" bigint PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"data" text NOT NULL,
	"decoded" jsonb,
	"reason_text" text,
	"proposer" text NOT NULL,
	"approvals" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_tx_hash" text,
	"executed_tx_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"data" jsonb NOT NULL,
	"pdf_url" text,
	"reviewed_by_person_id" integer,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_period_unique" UNIQUE("period")
);
--> statement-breakpoint
CREATE TABLE "sign_links" (
	"token" text PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"target" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer,
	"legal_name" text NOT NULL,
	"cuit" bigint NOT NULL,
	"address" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_cuit_unique" UNIQUE("cuit"),
	CONSTRAINT "vendors_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "contribution_intents" ADD CONSTRAINT "contribution_intents_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_uploader_person_id_persons_id_fk" FOREIGN KEY ("uploader_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_person_id_persons_id_fk" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_links" ADD CONSTRAINT "sign_links_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_tx_log" ON "approvals" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_events_tx_log" ON "chain_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_tx_log" ON "contributions" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_id" ON "invoices" USING btree ("invoice_id");