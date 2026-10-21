const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const script = resolve(__dirname, "../scripts/prepare-release.mjs");
function prepare(
  t,
  {
    version = "0.2.0",
    repository = "clinica-web/n8n-nodes-clinica-web",
    mismatch,
  } = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "clinica-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const pkg = { name: "n8n-nodes-clinica-web", version: "0.2.0" };
  const lock = { version: "0.2.0", packages: { "": { version: "0.2.0" } } };
  const manifest = { ".": "0.2.0" };
  if (mismatch === "package") pkg.version = "0.1.0";
  if (mismatch === "lock") lock.version = "0.1.0";
  if (mismatch === "lock-root") lock.packages[""].version = "0.1.0";
  if (mismatch === "manifest") manifest["."] = "0.1.0";
  for (const [name, value] of Object.entries({
    "package.json": pkg,
    "package-lock.json": lock,
    ".release-please-manifest.json": manifest,
  })) {
    writeFileSync(join(cwd, name), JSON.stringify(value));
  }
  const result = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_VERSION: version,
      GITHUB_REPOSITORY: repository,
    },
  });
  return {
    ...result,
    pkg: JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")),
  };
}

test("release preparation records the publishing repository", (t) => {
  const result = prepare(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.pkg.repository, {
    type: "git",
    url: "git+https://github.com/clinica-web/n8n-nodes-clinica-web.git",
  });
});
for (const mismatch of ["package", "lock", "lock-root", "manifest"]) {
  test(`release preparation rejects mismatched ${mismatch} version`, (t) => {
    const result = prepare(t, { mismatch });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /versions must match/);
    assert.equal(result.pkg.repository, undefined);
  });
}
for (const version of ["", "0.2.0-beta.1", "v0.2.0"]) {
  test(`release preparation rejects unstable or invalid version: ${version}`, (t) => {
    const result = prepare(t, { version });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Only stable release versions/);
  });
}
test("release preparation rejects missing repository identity", (t) => {
  const result = prepare(t, { repository: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GITHUB_REPOSITORY/);
});
