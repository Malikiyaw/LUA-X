import test from "node:test";
import assert from "node:assert/strict";
import { server } from "./server.js";

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address.");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("health endpoint reports a healthy LUA-X service", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { service: "lua-x", status: "ok", version: "0.1.0" });
  });
});

test("plan endpoint compiles a creator prompt", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Build an animation system and test it." }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { brief: { specialistAgents: string[] } };
    assert.ok(body.brief.specialistAgents.includes("animation"));
    assert.ok(body.brief.specialistAgents.includes("playtest"));
  });
});
