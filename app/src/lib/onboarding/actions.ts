"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { createSignLink } from "@/lib/wallet/links";
import { env } from "@/lib/env";
import { pesos } from "@/lib/orchestrator/format";
import {
  createDraft,
  deployDraft,
  inviteSigner,
  loadOwned,
  parseCuit,
  readDraft,
  saveRules,
  signersOf,
  slugify,
  type DraftLine,
  type SignerRole,
} from "@/lib/onboarding";

const COOKIE = "minga_setup";

async function token(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

const PHONE = /^\+[1-9]\d{6,14}$/;

export async function startCooperativa(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const school = String(form.get("school") ?? "").trim();
  const cuit = parseCuit(String(form.get("cuit") ?? ""));
  const organizerName = String(form.get("organizerName") ?? "").trim();
  const organizerPhone = String(form.get("organizerPhone") ?? "").trim();
  if (!name || !school || !cuit || !organizerName || !PHONE.test(organizerPhone)) {
    redirect("/start?error=Check+the+name,+school,+11-digit+CUIT+and+phone+(+5491112345678).");
  }
  const db = getDb();
  let created: { id: number; setupToken: string };
  try {
    created = await createDraft(db, {
      name,
      school,
      cuit,
      ruce: String(form.get("ruce") ?? ""),
      organizerName,
      organizerPhone,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not start.";
    redirect(`/start?error=${encodeURIComponent(message)}`);
  }
  (await cookies()).set(COOKIE, created.setupToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(`/c/${created.id}/setup`);
}

async function owned(id: number) {
  const row = await loadOwned(getDb(), id, await token());
  if (!row) redirect("/start?error=Open+this+page+from+the+browser+that+started+the+signup.");
  return row;
}

export async function invite(id: number, form: FormData) {
  const coop = await owned(id);
  try {
    await inviteSigner(getDb(), coop, {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      role: String(form.get("role") ?? "tesorero") as SignerRole,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not invite.";
    redirect(`/c/${id}/setup?error=${encodeURIComponent(message)}`);
  }
  redirect(`/c/${id}/setup`);
}

export async function saveSetup(id: number, form: FormData) {
  const coop = await owned(id);
  const names = form.getAll("lineName").map(String);
  const amounts = form.getAll("lineAmount").map(String);
  const ends = form.getAll("lineEnd").map(String);
  const lines: DraftLine[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;
    const pesosAmount = Number(amounts[i]);
    if (!Number.isFinite(pesosAmount) || pesosAmount <= 0) continue;
    const end = ends[i] ? Math.floor(new Date(ends[i]).getTime() / 1000) : Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180;
    lines.push({ slug: slugify(name), name, allocated: pesos(Math.round(pesosAmount)).toString(), periodEnd: end });
  }
  const signers = await signersOf(getDb(), id);
  const threshold = Math.min(Math.max(1, Number(form.get("threshold") ?? 1)), Math.max(1, signers.length));
  try {
    await saveRules(getDb(), coop, {
      threshold,
      perTxCap: pesos(Math.round(Number(form.get("perTx") ?? 0))).toString(),
      vendorMonthlyCap: pesos(Math.round(Number(form.get("monthly") ?? 0))).toString(),
      lines,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save.";
    redirect(`/c/${id}/setup?error=${encodeURIComponent(message)}`);
  }
  redirect(`/c/${id}/setup`);
}

export async function deploy(id: number) {
  const coop = await owned(id);
  let result: Awaited<ReturnType<typeof deployDraft>>;
  try {
    result = await deployDraft(getDb(), coop);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Deploy failed";
    redirect(`/c/${id}/setup?error=${encodeURIComponent(message)}`);
  }
  if (result.status === "dry-run") redirect(`/c/${id}/setup?error=AGENT_SEND+is+off,+so+nothing+was+deployed.`);
  redirect(`/c/${id}/settings`);
}

/** Passkey links for signers who do not have a Safe yet. */
export async function enrollLinks(id: number): Promise<{ name: string; url: string }[]> {
  const coop = await owned(id);
  const db = getDb();
  const signers = (await signersOf(db, id)).filter((s) => !s.person.safeAddress);
  const links = [];
  for (const s of signers) {
    const token = await createSignLink(db, {
      personId: s.person.id,
      purpose: "enroll",
      cooperadoraId: coop.id,
    });
    links.push({ name: s.person.name, url: `${env().APP_URL}/firmar/alta?t=${token}` });
  }
  return links;
}

/** Asks every signer who already has a passkey to approve a settings change on chain. */
export async function signerLinks(id: number): Promise<{ name: string; url: string }[]> {
  const coop = await owned(id);
  const db = getDb();
  const signers = (await signersOf(db, id)).filter((s) => s.person.safeAddress);
  const links = [];
  for (const s of signers) {
    const token = await createSignLink(db, {
      personId: s.person.id,
      purpose: "sign",
      target: { action: "propose" },
      cooperadoraId: coop.id,
    });
    links.push({ name: s.person.name, url: `${env().APP_URL}/firmar/proponer?t=${token}` });
  }
  return links;
}

export async function draftSummary(id: number) {
  const coop = await owned(id);
  return { coop, draft: readDraft(coop), signers: await signersOf(getDb(), id) };
}
