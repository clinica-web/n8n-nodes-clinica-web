// Run against a separately installed n8n-core; it is not a plugin dependency.
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");
const coreDirectory = process.argv[2];
if (!coreDirectory)
  throw new Error(
    "Usage: node scripts/check-n8n-loader.cjs <n8n-core package directory> [installed plugin directory]",
  );
const { PackageDirectoryLoader } = require(
  resolve(coreDirectory, "dist/nodes-loader/package-directory-loader.js"),
);
async function main() {
  const packageDirectory = process.argv[3]
    ? resolve(process.argv[3])
    : resolve(__dirname, "..");
  const loader = new PackageDirectoryLoader(packageDirectory);
  await loader.loadAll();
  assert.deepEqual(Object.keys(loader.nodeTypes).sort(), [
    "clinicaWeb",
    "clinicaWebTrigger",
  ]);
  assert.deepEqual(Object.keys(loader.credentialTypes), ["clinicaWebApi"]);
  const action = loader.getNode("clinicaWeb").type;
  const trigger = loader.getNode("clinicaWebTrigger").type;
  assert.equal(typeof action.execute, "function");
  assert.equal(typeof trigger.webhookMethods.default.create, "function");
  assert.equal(typeof trigger.webhookMethods.default.delete, "function");
  assert.equal(typeof trigger.webhook, "function");
  const credential = loader.getCredential("clinicaWebApi").type;
  assert.ok(
    credential.properties.some(
      (p) => p.name === "clientSecret" && p.typeOptions.password,
    ),
  );
  console.log(
    `n8n-core ${require(join(resolve(coreDirectory), "package.json")).version}: loaded both nodes and credentials from ${packageDirectory}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
