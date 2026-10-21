const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execute } = require("../dist/nodes/ClinicaWeb/execute");
const { operations, resolveSchema } = require("../dist/shared/catalog/catalog");
const { credentialTest } = require("../dist/shared/client/client");
const { credentials, mockFetch, context } = require("./helpers.cjs");

function sample(schema) {
  const shape = resolveSchema(schema);
  if (shape.enum) return shape.enum[0];
  if (shape.type === "array") return [sample(shape.items)];
  if (shape.type === "object") return {};
  if (["integer", "number"].includes(shape.type)) return 17;
  if (shape.type === "boolean") return false;
  return "sample / + text";
}
test("every catalog operation calls its pinned SDK route with mapped parameters and body", async (t) => {
  let active;
  const calls = mockFetch(t, (url, init) => {
    const { op, args, body } = active;
    let path = op.path;
    for (const p of op.parameters.filter((p) => p.location === "path"))
      path = path.replace(
        new RegExp("\\{" + p.wireName + "\\}", "i"),
        encodeURIComponent(String(args[p.name])),
      );
    assert.equal(decodeURI(url.pathname), decodeURI(path), op.id);
    assert.equal(init.method, op.method, op.id);
    for (const p of op.parameters.filter((p) => p.location === "query")) {
      const expected = Array.isArray(args[p.name])
        ? args[p.name].map(String)
        : [String(args[p.name])];
      assert.deepEqual(
        url.searchParams.getAll(p.wireName),
        expected,
        `${op.id}: ${p.name}`,
      );
    }
    if (op.body) assert.deepEqual(JSON.parse(init.body), body, op.id);
    if (op.binary)
      return new Response("%PDF-1.7 test", {
        headers: { "content-type": "application/pdf" },
      });
    if (/^GetPatient.*ConclusionById$/.test(op.id))
      return new Response(Buffer.from("test conclusion", "utf16le"), {
        headers: { "content-type": "text/plain; charset=utf-16le" },
      });
    return Response.json({ marker: op.id });
  });
  for (const op of operations) {
    const args = Object.fromEntries(
      op.parameters.map((p) => [p.name, sample(p.schema)]),
    );
    const params = {
      resource: op.resource,
      operation: op.id,
      optionalParameters: {},
    };
    for (const p of op.parameters) {
      if (p.required) params[`arg_${p.name}`] = args[p.name];
      else params.optionalParameters[p.name] = args[p.name];
    }
    const body = op.body ? sample(op.body.schema) : undefined;
    if (op.body) params.body = JSON.stringify(body);
    active = { op, args, body };
    await execute.call(context(params));
  }
  assert.equal(
    calls.filter((call) => call.url.hostname === "clinic.test").length,
    operations.length,
  );
});
test("one token per execution, scopes preserved, false query preserved and output items linked", async (t) => {
  const calls = mockFetch(t, () => Response.json([{ Id: 1 }, { Id: 2 }]));
  const params = {
    resource: "online.clinics",
    operation: "GetBookingClinics",
    optionalParameters: { onlineOnly: false },
  };
  const [items] = await execute.call(context([params, params]));
  assert.equal(
    calls.filter((c) => c.url.hostname === "identity.test").length,
    1,
  );
  assert.equal(
    new URLSearchParams(calls[0].init.body).get("scope"),
    credentials.scopes,
  );
  assert.equal(calls[1].url.searchParams.get("onlineOnly"), "false");
  assert.deepEqual(
    items.map((i) => i.pairedItem.item),
    [0, 0, 1, 1],
  );
});
test("tokens expire and are reacquired by the SDK during one execution", async (t) => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });
  const calls = mockFetch(t, () => {
    now += 3600001;
    return Response.json([]);
  });
  const params = { resource: "online.clinics", operation: "GetBookingClinics" };
  await execute.call(context([params, params]));
  assert.equal(
    calls.filter((c) => c.url.hostname === "identity.test").length,
    2,
  );
});
test("write failure is not retried and continue-on-fail preserves input index without error-body secrets", async (t) => {
  const calls = mockFetch(
    t,
    () => new Response("private patient data", { status: 403 }),
  );
  const [items] = await execute.call(
    context(
      {
        resource: "prerecords",
        operation: "CreatePublicPrerecord",
        body: "{}",
      },
      { continueOnFail: true },
    ),
  );
  assert.equal(calls.length, 2);
  assert.equal(items[0].pairedItem.item, 0);
  assert.match(items[0].json.error, /403/);
  assert.doesNotMatch(JSON.stringify(items), /private patient/);
});
test("nullable fields, false and zero in body survive SDK serialization", async (t) => {
  let body;
  mockFetch(t, (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json(42);
  });
  const value = {
    SchedulerId: 10,
    PatientId: null,
    Note: "",
    OnlinePaymentStatus: 0,
    Packages: [],
  };
  await execute.call(
    context({
      resource: "prerecords",
      operation: "CreatePublicPrerecord",
      body: value,
    }),
  );
  assert.deepEqual(body, value);
});
test("PDF responses use n8n binary data and preserve pairing", async (t) => {
  mockFetch(
    t,
    () =>
      new Response("%PDF-1.7 test", {
        headers: { "content-type": "application/pdf" },
      }),
  );
  const [items] = await execute.call(
    context({
      resource: "patients",
      operation: "PrintPatientAnalysis",
      arg_patientId: 1,
      arg_analysisId: 2,
    }),
  );
  assert.equal(
    Buffer.from(items[0].binary.data.data, "base64").toString(),
    "%PDF-1.7 test",
  );
  assert.equal(items[0].binary.data.mimeType, "application/pdf");
  assert.equal(items[0].pairedItem.item, 0);
});
test("invalid JSON fails before any token or API request", async (t) => {
  const calls = mockFetch(t, () => {
    throw new Error("unexpected request");
  });
  await assert.rejects(
    execute.call(
      context({
        resource: "prerecords",
        operation: "CreatePublicPrerecord",
        body: "{invalid",
      }),
    ),
    /valid JSON/,
  );
  assert.equal(calls.length, 0);
});
test("cancelled execution aborts before HTTP", async (t) => {
  const calls = mockFetch(t, () => {
    throw new Error("unexpected request");
  });
  await assert.rejects(
    execute.call(
      context(
        { resource: "online.clinics", operation: "GetBookingClinics" },
        { signal: AbortSignal.abort() },
      ),
    ),
  );
  assert.equal(calls.length, 0);
});
test("credential test obtains a token without calling a scoped API operation", async (t) => {
  const calls = mockFetch(t, () => {
    throw new Error("unexpected API request");
  });
  const result = await credentialTest.call({}, { data: credentials });
  assert.equal(result.status, "OK");
  assert.equal(calls.length, 1);
});
test("wildcard scopes are rejected before network access", async () => {
  const result = await credentialTest.call(
    {},
    { data: { ...credentials, scopes: "gambit:erp*" } },
  );
  assert.equal(result.status, "Error");
  assert.match(result.message, /wildcards/);
});

test("JSON strings cannot masquerade as object request bodies", async (t) => {
  const calls = mockFetch(t, () => {
    throw new Error("unexpected request");
  });
  await assert.rejects(
    execute.call(
      context({
        resource: "prerecords",
        operation: "CreatePublicPrerecord",
        body: '"{}"',
      }),
    ),
    /must be an object/,
  );
  assert.equal(calls.length, 0);
});

test("cancellation is not suppressed by continue-on-fail", async (t) => {
  const calls = mockFetch(t, () => {
    throw new Error("unexpected request");
  });
  await assert.rejects(
    execute.call(
      context(
        { resource: "online.clinics", operation: "GetBookingClinics" },
        { signal: AbortSignal.abort(), continueOnFail: true },
      ),
    ),
  );
  assert.equal(calls.length, 0);
});
