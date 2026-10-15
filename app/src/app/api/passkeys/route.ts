// Enrollment: stores a person's passkey and the address of the Safe it owns.
import { getDb } from "@/db";
import { registerPasskey } from "@/lib/wallet/enroll";
import { computeSafeAddress } from "@/lib/wallet/server";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid", message: "Incomplete data." }, { status: 400 });
  }
  try {
    const result = await registerPasskey(body, { db: getDb(), computeSafeAddress });
    if (!result.ok) return Response.json({ error: result.error, message: result.message }, { status: result.status });
    return Response.json({ safeAddress: result.safeAddress, name: result.personName });
  } catch (error) {
    console.error("passkey enrollment failed", error);
    return Response.json({ error: "server", message: "We couldn't save your signature. Try again in a bit." }, { status: 500 });
  }
}
