import { expect, test } from "vitest";
import { createTestDb } from "./testing";
import { persons } from "./schema";

test("test database has the schema", async () => {
  const db = await createTestDb();
  await db.insert(persons).values({ name: "Ana", phone: "+5493880000000", roles: ["socio"] });
  const rows = await db.select().from(persons);
  expect(rows).toHaveLength(1);
});
