const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  webhookMethods,
} = require("../dist/nodes/ClinicaWebTrigger/subscription");
const {
  ClinicaWebTrigger,
} = require("../dist/nodes/ClinicaWebTrigger/ClinicaWebTrigger.node");
const { credentials, mockFetch, context } = require("./helpers.cjs");
const lifecycle = webhookMethods.default;
function hooks(t) {
  const rows = new Map();
  let next = 1;
  let deleteStatus = 200;
  const calls = mockFetch(t, (url, init) => {
    const id = url.pathname.split("/")[3];
    if (init.method === "GET") {
      if (!id) return Response.json([...rows.values()]);
      return rows.has(id)
        ? Response.json(rows.get(id))
        : new Response(null, { status: 404 });
    }
    if (init.method === "POST") {
      const created = `subscription-${next++}`;
      rows.set(created, { ...JSON.parse(init.body), Id: created });
      return Response.json(created);
    }
    if (init.method === "PUT") {
      rows.set(id, { ...JSON.parse(init.body), Id: id });
      return new Response(null, { status: 200 });
    }
    if (deleteStatus !== 200)
      return new Response(null, { status: deleteStatus });
    rows.delete(id);
    return new Response(null, { status: 200 });
  });
  return {
    rows,
    calls,
    failDelete: (status) => {
      deleteStatus = status;
    },
  };
}
function hookContext(state, url, events = [0, 2], options = {}) {
  return {
    ...context({ events }, options),
    getNodeParameter: (key) => (key === "events" ? events : undefined),
    getWorkflowStaticData: () => state,
    getNodeWebhookUrl: () => url,
  };
}
test("activation, recovery and deactivation use exact URL and persist no secrets", async (t) => {
  const server = hooks(t);
  const state = {};
  const ctx = hookContext(state, "https://n8n.test/webhook/owned");
  assert.equal(await lifecycle.checkExists.call(ctx), false);
  assert.equal(await lifecycle.create.call(ctx), true);
  assert.equal(server.rows.size, 1);
  assert.equal(await lifecycle.checkExists.call(ctx), true);
  await lifecycle.create.call(ctx);
  assert.equal(server.rows.size, 1, "reactivation must not duplicate");
  const recovered = hookContext({}, "https://n8n.test/webhook/owned");
  assert.equal(await lifecycle.checkExists.call(recovered), true);
  assert.doesNotMatch(JSON.stringify(state), /secret|test-token/i);
  await lifecycle.delete.call(ctx);
  assert.equal(server.rows.size, 0);
  assert.deepEqual(state, {});
});
test("test and production subscriptions are isolated and unrelated hooks survive", async (t) => {
  const { rows } = hooks(t);
  rows.set("unrelated", {
    Id: "unrelated",
    Uri: "https://other.test",
    Triggers: [0],
  });
  const state = {};
  const prod = hookContext(state, "https://n8n.test/webhook/owned");
  const testCtx = hookContext(state, "https://n8n.test/webhook-test/owned");
  await lifecycle.create.call(prod);
  await lifecycle.create.call(testCtx);
  assert.equal(Object.keys(state).length, 2);
  await lifecycle.delete.call(testCtx);
  assert.equal(rows.size, 2);
  assert.equal(await lifecycle.checkExists.call(prod), true);
  assert.ok(rows.has("unrelated"));
});
test("event and secret changes update the owned subscription rather than creating duplicates", async (t) => {
  const { rows, calls } = hooks(t);
  const state = {};
  await lifecycle.create.call(hookContext(state, "https://n8n.test/hook"));
  const changed = hookContext(state, "https://n8n.test/hook", [3], {
    credentials: {
      ...credentials,
      webhookSecret: "different-test-secret-at-least-24",
    },
  });
  assert.equal(await lifecycle.checkExists.call(changed), false);
  await lifecycle.create.call(changed);
  assert.equal(rows.size, 1);
  assert.deepEqual([...rows.values()][0].Triggers, [3]);
  assert.equal(calls.filter((c) => c.init.method === "PUT").length, 1);
});
test("delete failure retains subscription ID for retry; missing remote subscription is harmless", async (t) => {
  const server = hooks(t);
  const state = {};
  const ctx = hookContext(state, "https://n8n.test/hook");
  await lifecycle.create.call(ctx);
  server.failDelete(503);
  await assert.rejects(lifecycle.delete.call(ctx), /503/);
  assert.equal(Object.keys(state).length, 1);
  server.rows.clear();
  await lifecycle.delete.call(ctx);
  assert.deepEqual(state, {});
});
test("cleanup works even when event configuration or webhook secret has been cleared", async (t) => {
  const { rows } = hooks(t);
  const state = {};
  await lifecycle.create.call(hookContext(state, "https://n8n.test/hook"));
  await lifecycle.delete.call(
    hookContext(state, "https://n8n.test/hook", [], {
      credentials: { ...credentials, webhookSecret: "" },
    }),
  );
  assert.equal(rows.size, 0);
});
test("duplicate URL registrations stop activation rather than arbitrarily taking ownership", async (t) => {
  const { rows } = hooks(t);
  for (const id of ["a", "b"])
    rows.set(id, { Id: id, Uri: "https://n8n.test/hook" });
  await assert.rejects(
    lifecycle.create.call(hookContext({}, "https://n8n.test/hook")),
    /Multiple subscriptions/,
  );
  assert.equal(rows.size, 2);
});
test("stale ID pointing to an unrelated URL is never deleted", async (t) => {
  const { rows } = hooks(t);
  const state = {};
  const ctx = hookContext(state, "https://n8n.test/hook");
  await lifecycle.create.call(ctx);
  [...rows.values()][0].Uri = "https://other.test";
  await assert.rejects(lifecycle.delete.call(ctx), /different URL/);
  assert.equal(rows.size, 1);
});
for (const [name, token, trigger, expectedStatus, expectedItems] of [
  ["valid", credentials.webhookSecret, 0, undefined, 1],
  ["wrong token", "wrong", 0, 401, 0],
  ["missing token", undefined, 0, 401, 0],
  ["malformed event", credentials.webhookSecret, "0", 400, 0],
  ["unselected event", credentials.webhookSecret, 3, undefined, 0],
]) {
  test(`webhook callback: ${name}`, async () => {
    let status;
    const response = {
      status(value) {
        status = value;
        return this;
      },
      json() {
        return this;
      },
    };
    const ctx = {
      ...context({}),
      getNodeParameter: () => [0],
      getHeaderData: () => ({ "x-clinicaweb-token": token }),
      getBodyData: () => ({ Trigger: trigger, Prerecord: { Id: 123 } }),
      getResponseObject: () => response,
    };
    const result = await new ClinicaWebTrigger().webhook.call(ctx);
    assert.equal(status, expectedStatus);
    assert.equal(result.workflowData?.[0]?.length ?? 0, expectedItems);
    if (expectedItems)
      assert.deepEqual(result.workflowData[0][0].json, {
        Trigger: 0,
        Prerecord: { Id: 123 },
      });
  });
}
