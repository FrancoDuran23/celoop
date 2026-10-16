ALTER TABLE "cooperadora" ALTER COLUMN "treasury_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cooperadora" ALTER COLUMN "box_factory_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cooperadora" ALTER COLUMN "config_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "onchain_id" integer;--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "threshold" integer;--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "per_tx_cap" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "vendor_monthly_cap" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "deploy_block" bigint;--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "cooperadora" ADD COLUMN "setup_token" text;--> statement-breakpoint
ALTER TABLE "cooperadora" ADD CONSTRAINT "cooperadora_setup_token_unique" UNIQUE("setup_token");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "cooperadora_id_seq";--> statement-breakpoint
SELECT setval('cooperadora_id_seq', COALESCE((SELECT MAX(id) FROM "cooperadora"), 1), (SELECT MAX(id) FROM "cooperadora") IS NOT NULL);--> statement-breakpoint
ALTER TABLE "cooperadora" ALTER COLUMN "id" SET DEFAULT nextval('cooperadora_id_seq');--> statement-breakpoint
ALTER SEQUENCE "cooperadora_id_seq" OWNED BY "cooperadora"."id";--> statement-breakpoint
CREATE TABLE "job_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "memberships" (
	"person_id" integer NOT NULL,
	"cooperadora_id" integer NOT NULL,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_person_id_cooperadora_id_pk" PRIMARY KEY("person_id","cooperadora_id")
);--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "memberships" ("person_id", "cooperadora_id", "roles")
SELECT p.id, 1, p.roles FROM "persons" p
WHERE EXISTS (SELECT 1 FROM "cooperadora" c WHERE c.id = 1);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" DROP CONSTRAINT "vendors_cuit_unique";--> statement-breakpoint
ALTER TABLE "vendors" DROP CONSTRAINT "vendors_address_unique";--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_coop_cuit" UNIQUE("cooperadora_id","cuit");--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_coop_address" UNIQUE("cooperadora_id","address");--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" DROP CONSTRAINT "budget_lines_pkey";--> statement-breakpoint
ALTER TABLE "budget_lines" ADD PRIMARY KEY ("cooperadora_id","line_id");--> statement-breakpoint
ALTER TABLE "budget_lines" DROP CONSTRAINT "budget_lines_slug_unique";--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_coop_slug" UNIQUE("cooperadora_id","slug");--> statement-breakpoint
ALTER TABLE "budget_index" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_index" ADD CONSTRAINT "budget_index_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_index" DROP CONSTRAINT "budget_index_pkey";--> statement-breakpoint
ALTER TABLE "budget_index" ADD PRIMARY KEY ("cooperadora_id","line_id");--> statement-breakpoint
ALTER TABLE "contribution_intents" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_intents" ADD CONSTRAINT "contribution_intents_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP INDEX "invoices_invoice_id";--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_coop_invoice_id" ON "invoices" USING btree ("cooperadora_id","invoice_id");--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_pkey";--> statement-breakpoint
ALTER TABLE "payments" ADD PRIMARY KEY ("cooperadora_id","payment_id");--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" DROP CONSTRAINT "audits_pkey";--> statement-breakpoint
ALTER TABLE "audits" ADD PRIMARY KEY ("cooperadora_id","payment_id");--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_pkey";--> statement-breakpoint
ALTER TABLE "proposals" ADD PRIMARY KEY ("cooperadora_id","proposal_id");--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_events" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_events" ADD CONSTRAINT "chain_events_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexer_cursor" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "indexer_cursor" ADD CONSTRAINT "indexer_cursor_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexer_cursor" DROP CONSTRAINT "indexer_cursor_pkey";--> statement-breakpoint
ALTER TABLE "indexer_cursor" ADD PRIMARY KEY ("cooperadora_id","key");--> statement-breakpoint
ALTER TABLE "agent_txs" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_txs" ADD CONSTRAINT "agent_txs_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "cooperadora_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_period_unique";--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_coop_period" UNIQUE("cooperadora_id","period");--> statement-breakpoint
ALTER TABLE "sign_links" ADD COLUMN "cooperadora_id" integer;--> statement-breakpoint
ALTER TABLE "sign_links" ADD CONSTRAINT "sign_links_cooperadora_id_cooperadora_id_fk" FOREIGN KEY ("cooperadora_id") REFERENCES "public"."cooperadora"("id") ON DELETE no action ON UPDATE no action;
