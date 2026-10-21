# CI/CD and npm releases

This follows the SDK repository's Release Please and npm Trusted Publishing flow.

## Checks

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual
dispatches. Node.js 22 and 24 both run `npm ci`, `npm run verify`, and
`npm pack --dry-run`. PR titles must follow Conventional Commits, for example
`feat: add appointment operations` or `fix: preserve webhook subscription state`.

Use squash merges with the PR title as the commit title. In GitHub repository
Settings → General → Pull Requests, enable squash merging and select **Pull
request title** for the default commit message. Disable merge commits and rebase
merging if you want this convention enforced for all merges.

## One-time setup

1. Push the workflows to `main`. In Settings → Actions → General, allow GitHub
   Actions to create and approve pull requests. Workflow permissions are declared
   explicitly in YAML; the repository's default can remain read-only.
2. Create the GitHub environment `npm`, restricted to the `main` branch.
3. Bootstrap the currently unpublished package from a verified checkout:

   ```sh
   npm ci
   npm run verify
   npm login
   npm publish --access public --tag latest
   ```

   This first publication uses your npm account and may request 2FA. The starting
   package and Release Please manifest are both `0.1.0`.

4. Open the npm package Settings → Trusted Publisher and choose GitHub Actions:

   | Field                | Value                   |
   | -------------------- | ----------------------- |
   | Organization or user | `clinica-web`           |
   | Repository           | `n8n-nodes-clinica-web` |
   | Workflow filename    | `release.yml`           |
   | Environment          | `npm`                   |

   Allow direct publishing with `npm publish` if the UI presents allowed actions.
   No `NPM_TOKEN` secret is required. Configure this before merging a release PR.

See [npm's Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Normal releases

1. Merge a conventional `feat:` or `fix:` change into `main`.
2. Release Please creates or updates a release PR with the changelog, package
   version, lockfile and manifest. It explicitly dispatches CI on this branch
   because PR events created with `GITHUB_TOKEN` do not normally start workflows.
3. Review the checks and merge the release PR. Release Please creates a GitHub
   release and tag; the publish job checks out that exact release SHA.
4. The publish job verifies the package again on Node.js 24, checks that all
   versions agree, and publishes `latest` through OIDC in the `npm` environment.

Before 1.0, features bump the minor version and fixes bump the patch version.
Prerelease versions are rejected by the publishing validation. Documentation and
CI-only commits do not by themselves trigger a release. The first feature after
the `0.1.0` bootstrap normally produces `0.2.0`.

If publishing fails after the GitHub release is created, fix the external npm
configuration and use **Re-run failed jobs** on that workflow run. Do not rerun
all jobs: Release Please may no longer report a newly created release. Never
attempt to overwrite a version already published to npm.

Updating the SDK dependency also requires regenerating the catalog from that
SDK version's source checkout. `npm run catalog:check` enforces this in CI.
