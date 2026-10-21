# Clinica Web for self-hosted n8n

Community node package backed by `@clinica-web/sdk@0.2.0`. Requires Node.js 22+
and n8n 2.x. This package is for self-hosted installations; it is not a verified
n8n Cloud integration. The package has not been published to npm.

## Included

- **Clinica Web API** credentials: client credentials grant, exact scopes and a
  connection test against the token endpoint.
- **Clinica Web** action node: 519 operations across 82 resource groups from the
  pinned SDK schema: `gambit:static_data`, `gambit:public*`, `gambit:erp*`, webhooks.
  Public/ERP paths are included even where Swagger omits a scope annotation.
- **Clinica Web Trigger**: automatic subscription and unsubscription, 19 event
  types, and verification of `X-ClinicaWeb-Token` before emitting workflow items.
- Manual webhook list/get/create/update/delete operations in the action node.
- PDF output in the n8n binary property `data`; text output in `json.value`.

See [all operations and their scopes](docs/operations.md).
The `HandleExampleWebhook` operation calls the API's documented example receiver;
use `CreateWebhook` to subscribe or the Trigger for automatic subscriptions.

## Build and install

Maintainers: see [CI/CD and npm releases](docs/releases.md) for the initial
publication, Trusted Publisher configuration and automated release process.

```sh
npm ci
npm run verify
npm pack
```

Copy `n8n-nodes-clinica-web-0.1.0.tgz` to the n8n host. In the n8n service user's
community-nodes directory (normally `~/.n8n/nodes`):

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
# Only if this directory does not yet contain package.json:
npm init -y
npm install /path/to/n8n-nodes-clinica-web-0.1.0.tgz
```

Restart n8n. Community packages must be enabled. In Docker, install as the n8n
user in the persisted `/home/node/.n8n/nodes` directory, or bake the package into
your image. In queue mode, install the identical package/version on the main
instance and every worker. This is an npm package, not a script for a Code node.

## Credentials

1. Set **API URL** to the clinic deployment, e.g. `https://your-clinic.medakadem.com.ua`.
2. Keep **Token URL** as `https://id.medakadem.com/connect/token` unless your identity
   service uses a different URL.
3. Enter **Client ID** and **Client Secret** issued for the integration.
4. Enter exact, space-separated **Scopes** granted to that client. For example:
   `gambit:static_data gambit:webhooks gambit:public:prerecord:read`.
5. For a Trigger, set a random **Webhook Secret** of at least 24 characters.

`gambit:public*` and `gambit:erp*` describe catalog selection, not OAuth scope
values. The plugin does not request every scope automatically. Each operation
shows the scope documented by Swagger. Token issuance does not prove that every
API operation is authorized. Server-side permissions and business validation apply.

Secrets are stored in n8n credentials. SDK token caching is local to one action
execution or trigger lifecycle call; all input items in that execution share it.
Tokens are renewed before expiry. There is no global credential cache, patient
OTP flow or refresh-token flow. No automatic resource retries, including on 401,
are added, so writes are not silently replayed.

## Using the action node

Choose a resource and operation. Required route/query inputs appear individually;
optional filters appear under **Optional Parameters**. Omitted optional filters
stay omitted; explicitly supplied `false`, `0`, empty strings and body `null`
values retain their meaning. Arrays in query fields accept JSON arrays.

Operations show their summary and detailed API description. For object request
bodies, choose **Body Input → Fields** to see required fields and **Optional Body
Fields → Add Body Field**. Types, enum choices and descriptions come from the
pinned schema. Only added optional fields are sent. Nested objects and arrays
accept JSON or expressions in their own fields; they are not recursive forms.

**Body Input → JSON** retains **Body (JSON)** for complete objects, explicit nulls
and additional properties. JSON remains the default so existing workflows keep
working. Switching modes does not convert or merge values: only the selected
mode is sent. Array, primitive and unspecified bodies support JSON only.
Hover the JSON description for the model and top-level fields; the SDK/API uses
original, case-sensitive wire names.
Expressions may return a complete object. For example, **Prerecords → Create
Public Prerecord** accepts the API's `SchedulerId`, `DateStart`, `DateEnd`,
`PatientId`/`ExternalPatientId`, `Packages`, `Note` and `OnlinePaymentStatus` fields.
Use real identifiers and consult the API business requirements before creating
records. PUT operations may replace an entire entity; they are not partial patches.

One request is made for each input item. Arrays become separate output items with
input pairing; objects remain objects; scalar/text results use `value`. Successful
empty responses emit `{ "success": true }`. Empty arrays emit no items. Failures
honor n8n's **On Error** setting and retain the input index. Raw API error bodies
are deliberately not copied into execution data.

PDF endpoints use n8n's binary-data helper with a stream. Ordinary JSON lists and
reports are materialized by the SDK and n8n; this node does not promise bounded
memory for large report results. Narrow report ranges. Numeric inputs must fit
JavaScript's safe integer range. Dates remain strings, including supplied offsets.

## Webhook trigger

Enable **Show Payload Reference** to see the payload fields, types, available
descriptions and a synthetic JSON example for each selected event. Copy an
**Example JSON** into n8n's **set mock data** to design downstream mappings without
waiting for delivery. Reference/example controls do not change the subscription
or emitted payload. Examples are generated from the pinned schema, use placeholder
values and empty arrays, and are not captured events or valid IDs for API writes.
They do not automatically populate Output or execute the workflow.

For **Protocol Updated**, the example has `Trigger: 9` and a `Protocol` object
with fields including `ProtocolId`, `PatientId`, `Name` and `DateCreated`.
The event-to-payload member mapping was checked against the backend's
`WebhookProvider` and `WebhookUpdateEvent`; the backend was not modified.

Set public `WEBHOOK_URL` correctly on n8n, select credentials and events, then
activate/publish the workflow. The Trigger registers its generated callback URL.
Deactivation removes only its own subscription. Test and production URLs have
separate persisted subscription IDs. Repeated activation recovers the registration
by exact URL and updates changed events/secret rather than adding duplicates.
Failures other than 404 retain state and surface an error so cleanup can be retried.

Clinica Web documents a delay of up to **5 minutes** before webhook changes take
effect. This can exceed n8n's test-listening window; use an active test workflow
when necessary. Deactivate before changing the API host or client identity. After
changing the secret, reactivate all workflows using those credentials.

Only an authenticated payload with a known numeric `Trigger` starts the workflow.
Headers, the secret and authorization tokens are not emitted. Events not selected
by this node are ignored. Clinica Web can retry delivery; downstream writes should
be idempotent. The plugin does not claim exactly-once delivery.

For manual subscriptions, **Webhooks → Create Webhook** takes a body like:

```json
{
  "Uri": "https://your-receiver.example/webhook",
  "Triggers": [0, 1, 2],
  "SecretToken": "your-long-random-webhook-secret"
}
```

The result's `value` is the subscription ID; pass it to **Delete Webhook** to
unsubscribe. Manual operations do not manage a Trigger's lifecycle.

## Development and catalog updates

The committed catalog is derived from the SDK's checked-in OpenAPI snapshot and
operation mappings, not from a network download at runtime. The production
dependency comes from npm; there is no dependency on a sibling checkout.

To upgrade, pin the intended `@clinica-web/sdk` version, install it, then regenerate
from the matching SDK checkout:

```sh
npm run catalog:generate -- /path/to/clinica-web-nodejs-sdk
npm run format
npm run verify
```

Review the operation/scope diff. `docs/catalog-source.json` records the SDK version,
source schema hash and generated hashes. `catalog:check` verifies those hashes and
that each selected SDK method exists. Regeneration refuses missing mappings.

The SDK uses Node's native `fetch`, with cancellation and manual redirect handling.
n8n HTTP Request node-specific proxy settings are not applied to this transport;
configure connectivity and CA trust for the n8n Node.js process. TLS verification
is not disabled. Do not put credentials in URLs.

Tests use synthetic API responses and local test credentials; they do not create
records or subscriptions on a real Clinica Web deployment. See
[verification notes](docs/verification.md) for the checks actually performed.

References: [Clinica Web Swagger](https://dev.medakadem.com.ua/swagger/index.html),
[SDK](https://github.com/clinica-web/clinica-web-nodejs-sdk),
[n8n manual installation](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/).
