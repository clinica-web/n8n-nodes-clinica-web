const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NodeHelpers } = require("n8n-workflow");
const { ClinicaWeb } = require("../dist/nodes/ClinicaWeb/ClinicaWeb.node");
const { operations } = require("../dist/shared/catalog/catalog");

test("n8n resolves defaults and displayed fields for every operation", () => {
  const { description } = new ClinicaWeb();
  for (const op of operations) {
    const input = { resource: op.resource, operation: op.id };
    const resolved = NodeHelpers.getNodeParameters(
      description.properties,
      input,
      true,
      false,
      { typeVersion: 1 },
      description,
    );
    assert.equal(resolved.resource, op.resource, op.id);
    assert.equal(resolved.operation, op.id, op.id);
    for (const parameter of op.parameters.filter((p) => p.required)) {
      assert.ok(
        Object.hasOwn(resolved, `arg_${parameter.name}`),
        `${op.id}: ${parameter.name}`,
      );
    }
    assert.equal(Object.hasOwn(resolved, "body"), Boolean(op.body), op.id);
    assert.equal(resolved.timeout, 60);
  }
});
test("default resource has a valid default operation", () => {
  const { description } = new ClinicaWeb();
  const defaults = NodeHelpers.getNodeParameters(
    description.properties,
    {},
    true,
    false,
    { typeVersion: 1 },
    description,
  );
  assert.ok(
    operations.some(
      (op) => op.id === defaults.operation && op.resource === defaults.resource,
    ),
  );
});
