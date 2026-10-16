// Posts to Minga's tick and auditor. TICK_SECRET is a Worker secret, the same value as on Vercel.
export default {
  async scheduled(_event, env) {
    const results = await Promise.allSettled([ping(env, "/api/tick"), ping(env, "/api/auditor")]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      throw new Error(failed.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))).join("\n"));
    }
  },
};

async function ping(env, path) {
  const base = String(env.APP_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("APP_URL is not set");
  if (!env.TICK_SECRET) throw new Error("TICK_SECRET is not set");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TICK_SECRET}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} ${res.status} ${body.slice(0, 200)}`);
  }
}
