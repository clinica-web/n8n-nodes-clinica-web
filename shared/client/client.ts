import {
  createClinicaClient,
  ApiError,
  type ClinicaClient,
} from "@clinica-web/sdk";
import { createClientCredentialsProvider } from "@clinica-web/sdk/auth";
import type {
  ICredentialDataDecryptedObject,
  ICredentialTestFunctions,
  INodeCredentialTestResult,
} from "n8n-workflow";

export const credentialName = "clinicaWebApi";

function requiredString(
  credentials: ICredentialDataDecryptedObject,
  key: string,
): string {
  const value = credentials[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Configure ${key} in Clinica Web credentials`);
  return value;
}
export function connectionOptions(credentials: ICredentialDataDecryptedObject) {
  const baseUrl = requiredString(credentials, "baseUrl")
    .trim()
    .replace(/\/+$/, "");
  const tokenUrl = requiredString(credentials, "tokenUrl").trim();
  for (const value of [baseUrl, tokenUrl]) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use an HTTP(S) URL without embedded credentials, query parameters or a fragment",
      );
  }
  const scopes = [
    ...new Set(requiredString(credentials, "scopes").trim().split(/\s+/)),
  ];
  if (scopes.some((scope) => scope.includes("*")))
    throw new Error("Enter exact OAuth scopes; wildcards are not supported");
  return {
    baseUrl,
    clientId: requiredString(credentials, "clientId"),
    clientSecret: requiredString(credentials, "clientSecret"),
    scopes,
    tokenUrl,
  };
}
export function createClient(
  credentials: ICredentialDataDecryptedObject,
): ClinicaClient {
  const { baseUrl, ...auth } = connectionOptions(credentials);
  const provider = createClientCredentialsProvider(auth);
  // Static-data operations also live in the SDK's online area. Explicitly share
  // this client-credentials identity; no patient or referring flow is exposed.
  return createClinicaClient({
    baseUrl,
    accessToken: provider.getAccessToken,
    online: { accessToken: provider.getAccessToken },
  });
}
export function errorMessage(error: unknown): string {
  if (error instanceof SyntaxError) return "Clinica Web returned invalid JSON";
  // Do not persist raw HTTP error bodies: they can contain patient data or secrets.
  if (error instanceof ApiError)
    return `Clinica Web returned HTTP ${error.status}. Check permissions and the operation's input.`;
  return error instanceof Error ? error.message : "Clinica Web request failed";
}
export async function credentialTest(
  this: ICredentialTestFunctions,
  credential: { data?: ICredentialDataDecryptedObject },
): Promise<INodeCredentialTestResult> {
  try {
    const { baseUrl: _baseUrl, ...auth } = connectionOptions(
      credential.data ?? {},
    );
    await createClientCredentialsProvider(auth).getAccessToken();
    return {
      status: "OK",
      message:
        "Client credentials accepted. API permissions depend on the requested scopes.",
    };
  } catch (error) {
    return { status: "Error", message: errorMessage(error) };
  }
}
