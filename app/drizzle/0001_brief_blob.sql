CREATE TABLE "audits" (
	"payment_id" bigint PRIMARY KEY NOT NULL,
	"verdict" text NOT NULL,
	"findings" jsonb NOT NULL,
	"report_json" text NOT NULL,
	"report_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "audit" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "audit_report_hash" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "audit_tx_hash" text;