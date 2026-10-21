const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { createHash } = require("node:crypto");
const { createClinicaClient } = require("@clinica-web/sdk");

const root = resolve(__dirname, "..");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const client = createClinicaClient({ baseUrl: "https://example.invalid" });
function verifyMethods(operations) {
  const ids = new Set();
  for (const operation of operations) {
    if (ids.has(operation.id))
      throw new Error(`Duplicate operation: ${operation.id}`);
    ids.add(operation.id);
    const method = operation.sdkMethod
      .split(".")
      .reduce((value, key) => value?.[key], client);
    if (typeof method !== "function")
      throw new Error(`SDK method missing: ${operation.sdkMethod}`);
  }
}
if (process.argv.includes("--check")) {
  const operations = read(join(root, "shared/catalog/operations.json"));
  verifyMethods(operations);
  const source = read(join(root, "docs/catalog-source.json"));
  const pkg = read(join(root, "package.json"));
  if (source.sdkVersion !== pkg.dependencies["@clinica-web/sdk"])
    throw new Error("SDK/catalog version mismatch");
  for (const [file, hash] of Object.entries(source.generatedHashes)) {
    if (
      createHash("sha256")
        .update(readFileSync(join(root, file)))
        .digest("hex") !== hash
    )
      throw new Error(`Regenerate the catalog: ${file}`);
  }
  console.log(`Verified ${operations.length} SDK bindings and catalog hashes`);
  process.exit(0);
}
const sdkPath = process.argv[2];
if (!sdkPath)
  throw new Error(
    "Usage: npm run catalog:generate -- <SDK checkout directory>",
  );
const sdk = resolve(sdkPath);
const schemaBytes = readFileSync(join(sdk, "openapi/swagger.json"));
const schema = JSON.parse(schemaBytes);
const mapping = read(join(sdk, "openapi/operations.json"));
const sdkVersion = read(join(sdk, "package.json")).version;
if (
  sdkVersion !==
  read(join(root, "package.json")).dependencies["@clinica-web/sdk"]
)
  throw new Error("Pin the same SDK version in package.json before generation");
const operations = [];
const schemas = {};
function collect(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    const name = value.$ref.split("/").pop();
    if (!Object.hasOwn(schemas, name)) {
      const definition = schema.components.schemas[name];
      if (!definition) throw new Error(`Missing schema: ${name}`);
      schemas[name] = definition;
      collect(definition);
    }
  }
  Object.values(value).forEach(collect);
}
for (const entry of mapping) {
  const op = schema.paths[entry.path][entry.method];
  const scopes = [
    ...new Set((op.description ?? "").match(/gambit:[a-zA-Z0-9_:.-]+/g) ?? []),
  ];
  if (
    !scopes.some((scope) =>
      /^(gambit:static_data$|gambit:public|gambit:erp|gambit:webhooks$)/.test(
        scope,
      ),
    ) &&
    !/^\/api\/(erp|public)\//.test(entry.path) &&
    !/^\/api\/webhooks(?:\/|$)/.test(entry.path)
  )
    continue;
  const parameters = entry.parameters.map((parameter) => {
    // SDK normalizes ASP.NET path placeholders whose Swagger casing differs.
    const source = (op.parameters ?? []).find(
      (item) =>
        item.in === parameter.in &&
        (item.name === parameter.name ||
          (item.in === "path" &&
            item.name.toLowerCase() === parameter.name.toLowerCase())),
    );
    if (!source)
      throw new Error(
        `Missing parameter metadata for ${entry.operationId}: ${parameter.name}`,
      );
    collect(source.schema);
    return {
      name: parameter.field,
      wireName: parameter.name,
      location: parameter.in,
      required: parameter.required,
      schema: source.schema,
      description: source.description ?? "",
    };
  });
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (entry.bodyField && !bodySchema)
    throw new Error(`Unsupported body: ${entry.operationId}`);
  collect(bodySchema);
  operations.push({
    id: entry.operationId,
    resource:
      entry.area === "main"
        ? entry.resource
        : `${entry.area}.${entry.resource}`,
    sdkMethod:
      entry.reader === "raw"
        ? entry.rawMethod
        : entry.sdkMethods.find(
            (method) =>
              method !== entry.rawMethod &&
              !method.split(".").pop().startsWith("stream"),
          ),
    hasArguments: entry.arguments.length > 0,
    method: entry.method.toUpperCase(),
    path: entry.path,
    scopes,
    description: op.summary ?? "",
    deprecated: op.deprecated ?? false,
    parameters,
    ...(entry.bodyField
      ? {
          body: {
            name: entry.bodyField,
            required: entry.arguments.find(
              (arg) => arg.name === entry.bodyField,
            ).required,
            schema: bodySchema,
          },
        }
      : {}),
    binary: entry.reader === "raw",
  });
}
collect(schema.components.schemas.WebhookTriggers);
schemas.WebhookTriggers = schema.components.schemas.WebhookTriggers;
verifyMethods(operations);
operations.sort(
  (a, b) => a.resource.localeCompare(b.resource) || a.id.localeCompare(b.id),
);
mkdirSync(join(root, "shared/catalog"), { recursive: true });
mkdirSync(join(root, "docs"), { recursive: true });
const generatedHashes = {};
for (const [file, data] of [
  ["shared/catalog/operations.json", operations],
  ["shared/catalog/schemas.json", schemas],
]) {
  const bytes = JSON.stringify(data, null, 2) + "\n";
  writeFileSync(join(root, file), bytes);
  generatedHashes[file] = createHash("sha256").update(bytes).digest("hex");
}
writeFileSync(
  join(root, "docs/catalog-source.json"),
  JSON.stringify(
    {
      sdkVersion,
      schemaSha256: createHash("sha256").update(schemaBytes).digest("hex"),
      source: read(join(sdk, "openapi/source.json")),
      operationCount: operations.length,
      generatedHashes,
    },
    null,
    2,
  ) + "\n",
);
const lines = [
  "# Supported operations",
  "",
  "Generated from the pinned SDK schema. Scope values are exact; wildcards are not sent to OAuth.",
  "",
  "| Resource | Operation | HTTP | Scope |",
  "| --- | --- | --- | --- |",
];
for (const op of operations)
  lines.push(
    `| ${op.resource} | ${op.id}${op.deprecated ? " (deprecated)" : ""} | ${op.method} ${op.path} | ${op.scopes.join(", ") || "Not declared by Swagger"} |`,
  );
writeFileSync(join(root, "docs/operations.md"), lines.join("\n") + "\n");
console.log(
  `Generated ${operations.length} operations across ${new Set(operations.map((op) => op.resource)).size} resources`,
);
