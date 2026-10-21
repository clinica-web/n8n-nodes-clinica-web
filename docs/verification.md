# Verification

The package is tested against the real published SDK with controlled HTTP responses.
No authenticated live Clinica Web deployment has been tested.

- Every selected operation is exercised through the action node, SDK argument
  mapping, URL serialization and response reader.
- Tests cover token acquisition/expiry, scopes, item pairing, nullable request
  bodies, non-retried write errors, invalid input, cancellation and binary PDF data.
- Trigger tests cover registration, recovery, updates, cleanup, failed cleanup,
  separate test/production URLs, duplicate detection, ownership checks and
  authenticated callback handling.

Run `npm run verify` for type checking, catalog checks, formatting and tests.
The full n8n runtime check is separate because n8n is not a production dependency
of a community-node package.

## Local results (2026-10-21)

- TypeScript build and catalog integrity checks passed.
- 42 tests passed, including all 519 SDK routes, n8n's parameter/default
  resolution for every operation, Fields-mode serialization for every object
  request body, omitted optional fields, malformed JSON, missing required fields,
  detailed operation documentation and payload-reference visibility for all 19
  events (including multiple selections).
- The new controls have not been visually verified in a running n8n editor.
- The official `n8n-core@2.44.3` `PackageDirectoryLoader` loaded both nodes and
  the credentials successfully, both from the workspace and from an independently
  installed `.tgz` package. Repeat with:

  ```sh
  node scripts/check-n8n-loader.cjs /path/to/node_modules/n8n-core
  ```

- Full n8n 2.44.5 server startup was not verified: its `isolated-vm` dependency
  failed native installation on this Windows host because the Windows SDK was
  unavailable. Docker Engine was also not running. No system tooling was changed.
- Callback response handling was checked against n8n 2.44.5's published webhook
  handler: node callbacks execute before the immediate response, and omitted
  `workflowData` prevents starting a workflow for rejected/ignored callbacks.

Still required on the target host: install/restart n8n, test real credentials,
activate a Trigger with a public callback URL, deliver an event and deactivate
the workflow to confirm remote cleanup. These checks require the clinic's
credentials and a reachable n8n deployment.
