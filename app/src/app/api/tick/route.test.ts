import { beforeEach, expect, test, vi } from "vitest";
import { resetEnv } from "@/lib/env";
import type { AgentDeps } from "@/lib/orchestrator/deps";
import { testAgent } from "@/lib/orchestrator/testing";

let deps: AgentDeps;
vi.mock("@/lib/orchestrator/runtime", () => ({ productionDeps: () => deps }));

const { POST } = await import("./route");

const post = (auth?: string) =>
  new Request("http://localhost/api/tick", { method: "POST", headers: auth ? { authorization: auth } : {} });

let t: Awaited<ReturnType<typeof testAgent>>;
beforeEach(async () => {
  resetEnv({ TICK_SECRET: "tick-secret" });
  t = await testAgent();
  deps = t.deps;
});

test("the tick needs the bearer secret", async () => {
  expect((await POST(post())).status).toBe(401);
  expect((await POST(post("Bearer wrong"))).status).toBe(401);
  expect((await POST(post("tick-secret"))).status).toBe(401);
  expect(t.indexer.runs).toBe(0);
});

test("with the secret it runs the tick", async () => {
  const res = await POST(post("Bearer tick-secret"));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, errors: [] });
  expect(t.indexer.runs).toBe(1);
});
