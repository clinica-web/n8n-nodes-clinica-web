const assert = require("node:assert/strict");
const credentials = {
  baseUrl: "https://clinic.test",
  tokenUrl: "https://identity.test/connect/token",
  clientId: "test-client",
  clientSecret: "test-secret",
  scopes: "gambit:static_data gambit:webhooks gambit:public:prerecord:write",
  webhookSecret: "test-webhook-secret-at-least-24-characters",
};
function mockFetch(t, handler, expiresIn = 3600) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.hostname === "identity.test") {
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "manual");
      assert.equal(
        new URLSearchParams(init.body).get("grant_type"),
        "client_credentials",
      );
      return Response.json({
        access_token: "test-token",
        token_type: "Bearer",
        expires_in: expiresIn,
      });
    }
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer test-token",
    );
    return handler(url, init);
  };
  t.after(() => {
    global.fetch = original;
  });
  return calls;
}
function context(params, options = {}) {
  return {
    getCredentials: async () => options.credentials ?? credentials,
    getNodeParameter: (key, index, fallback) => {
      const values = Array.isArray(params) ? params[index] : params;
      return Object.hasOwn(values, key) ? values[key] : fallback;
    },
    getInputData: () =>
      (Array.isArray(params) ? params : [params]).map(() => ({ json: {} })),
    getNode: () => ({
      name: "Clinica Web",
      type: "clinicaWeb",
      typeVersion: 1,
      parameters: {},
      position: [0, 0],
    }),
    continueOnFail: () => options.continueOnFail ?? false,
    getExecutionCancelSignal: () => options.signal,
    helpers: {
      returnJsonArray: (data) =>
        (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
      prepareBinaryData: async (stream, fileName, mimeType) => {
        const parts = [];
        for await (const part of stream) parts.push(part);
        return {
          data: Buffer.concat(parts).toString("base64"),
          fileName,
          mimeType,
        };
      },
    },
  };
}
module.exports = { credentials, mockFetch, context };
