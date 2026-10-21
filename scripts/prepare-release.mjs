import { readFile, writeFile } from "node:fs/promises";

const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const pkg = await read("package.json");
const lock = await read("package-lock.json");
const manifest = await read(".release-please-manifest.json");
const version = process.env.RELEASE_VERSION;
const repository = process.env.GITHUB_REPOSITORY;
if (!version || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Only stable release versions may publish to latest");
if (
  [pkg.version, lock.version, lock.packages[""].version, manifest["."]].some(
    (v) => v !== version,
  )
)
  throw new Error(
    "Release, package, lockfile and manifest versions must match",
  );
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
  throw new Error("GITHUB_REPOSITORY must identify the publishing repository");
// Set the actual repository in the published artifact, without guessing an owner.
pkg.repository = {
  type: "git",
  url: `git+https://github.com/${repository}.git`,
};
await writeFile("package.json", JSON.stringify(pkg, null, 2) + "\n");
