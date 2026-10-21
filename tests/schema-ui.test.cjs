const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NodeHelpers } = require("n8n-workflow");
const { ClinicaWeb } = require("../dist/nodes/ClinicaWeb/ClinicaWeb.node");
const {
  ClinicaWebTrigger,
} = require("../dist/nodes/ClinicaWebTrigger/ClinicaWebTrigger.node");
const {
  payloadReferences,
} = require("../dist/nodes/ClinicaWebTrigger/payload/payload");
const { operations, resolveSchema } = require("../dist/shared/catalog/catalog");
const { execute } = require("../dist/nodes/ClinicaWeb/execute");
const { mockFetch, context } = require("./helpers.cjs");

function resolve(description, input) {
  return NodeHelpers.getNodeParameters(
    description.properties,
    input,
    true,
    false,
    { typeVersion: 1 },
    description,
  );
}
function sample(schema) {
  const shape = resolveSchema(schema);
  if (shape.enum) return shape.enum[0];
  if (shape.type === "boolean") return false;
  if (["integer", "number"].includes(shape.type)) return 0;
  if (shape.type === "array") return [];
  if (shape.type === "object") return {};
  return "sample";
}
const objectOperations = operations.filter(
  (op) =>
    op.body &&
    Object.keys(resolveSchema(op.body.schema).properties ?? {}).length,
);

test("every object body exposes schema fields in Fields mode and hides JSON", () => {
  const { description } = new ClinicaWeb();
  for (const op of objectOperations) {
    const params = resolve(description, {
      resource: op.resource,
      operation: op.id,
      bodyMode: "fields",
    });
    assert.equal(params.bodyMode, "fields", op.id);
    assert.equal(Object.hasOwn(params, "body"), false, op.id);
    for (const name of resolveSchema(op.body.schema).required ?? [])
      assert.ok(Object.hasOwn(params, `body_${name}`), `${op.id}: ${name}`);
  }
});

test("Fields mode preserves wire casing, false, zero and nested JSON for every object operation", async (t) => {
  let expected;
  mockFetch(t, (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), expected);
    return Response.json({ ok: true });
  });
  for (const op of objectOperations) {
    const shape = resolveSchema(op.body.schema);
    const params = {
      resource: op.resource,
      operation: op.id,
      bodyMode: "fields",
      bodyFields: {},
      body: '{"mustNotBeSent":true}',
    };
    for (const p of op.parameters.filter((p) => p.required))
      params[`arg_${p.name}`] = sample(p.schema);
    expected = {};
    for (const [name, schema] of Object.entries(shape.properties)) {
      expected[name] = sample(schema);
      const value =
        typeof expected[name] === "object"
          ? JSON.stringify(expected[name])
          : expected[name];
      if (shape.required?.includes(name)) params[`body_${name}`] = value;
      else params.bodyFields[name] = value;
    }
    await execute.call(context(params));
  }
});

test("optional fields not selected are omitted from the request", async (t) => {
  mockFetch(t, (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      Uri: "https://example.invalid/hook",
      Triggers: [9],
    });
    return Response.json("webhook-id");
  });
  await execute.call(
    context({
      resource: "webhooks",
      operation: "CreateWebhook",
      bodyMode: "fields",
      bodyFields: { Uri: "https://example.invalid/hook", Triggers: "[9]" },
    }),
  );
});

test("invalid nested JSON fails before any HTTP request", async (t) => {
  const calls = mockFetch(t, () => assert.fail("Unexpected request"));
  await assert.rejects(
    execute.call(
      context({
        resource: "webhooks",
        operation: "CreateWebhook",
        bodyMode: "fields",
        bodyFields: { Triggers: "not json" },
      }),
    ),
    /Body.Triggers must contain valid JSON/,
  );
  assert.equal(calls.length, 0);
});

test("missing required body field fails before HTTP", async (t) => {
  const op = objectOperations.find(
    (entry) => resolveSchema(entry.body.schema).required?.length,
  );
  const params = {
    resource: op.resource,
    operation: op.id,
    bodyMode: "fields",
  };
  for (const p of op.parameters.filter((p) => p.required))
    params[`arg_${p.name}`] = sample(p.schema);
  const calls = mockFetch(t, () => assert.fail("Unexpected request"));
  await assert.rejects(execute.call(context(params)), /Body\..* is required/);
  assert.equal(calls.length, 0);
});

test("operation descriptions include the detailed API documentation", () => {
  const { description } = new ClinicaWeb();
  const notice = description.properties.find(
    (p) =>
      p.name === "operationInfo" &&
      p.displayOptions.show.operation.includes("HandleExampleWebhook"),
  );
  assert.match(notice.displayName, /soft-deleted record/);
});

test("selected events expose their own payload references and synthetic examples", () => {
  const { description } = new ClinicaWebTrigger();
  for (const reference of payloadReferences) {
    const event = reference.event.value;
    const params = resolve(description, {
      events: [event],
      showPayloadReference: true,
    });
    assert.deepEqual(
      JSON.parse(params[`payloadExample_${event}`]),
      reference.example,
    );
    assert.deepEqual(Object.keys(reference.example), [
      "Trigger",
      reference.field,
    ]);
    assert.ok(params[`payloadReference_${event}`].includes(reference.field));
    assert.equal(
      Object.keys(params).filter((key) => key.startsWith("payloadExample_"))
        .length,
      1,
    );
  }
  const selected = resolve(description, {
    events: [0, 9],
    showPayloadReference: true,
  });
  assert.ok(selected.payloadExample_0 && selected.payloadExample_9);
  assert.equal(
    Object.keys(resolve(description, { events: [9] })).some((key) =>
      key.startsWith("payloadExample_"),
    ),
    false,
  );
  const protocol = payloadReferences.find((item) => item.event.value === 9);
  assert.match(protocol.description, /Save button/);
  assert.equal(protocol.example.Protocol.ProtocolId, 1);
});
