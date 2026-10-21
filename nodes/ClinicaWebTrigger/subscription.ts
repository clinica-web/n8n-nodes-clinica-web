import { createHash } from "node:crypto";
import { ApiError, type WebhookTriggers } from "@clinica-web/sdk";
import type { IHookFunctions, IDataObject } from "n8n-workflow";
import { createClient, credentialName } from "../../shared/client/client";
import { triggerOptions } from "../../shared/catalog/catalog";

export function selectedTriggers(value: unknown): WebhookTriggers[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (item) => !triggerOptions.some((option) => option.value === item),
    )
  )
    throw new Error("Select at least one supported webhook event");
  return [...new Set(value as WebhookTriggers[])].sort((a, b) => a - b);
}
export function webhookSecret(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 24)
    throw new Error(
      "Set a random Webhook Secret of at least 24 characters in Clinica Web credentials",
    );
  return value;
}
async function subscription(context: IHookFunctions) {
  const credentials = await context.getCredentials(credentialName);
  const url = context.getNodeWebhookUrl("default");
  if (!url) throw new Error("n8n did not provide a webhook URL");
  const state = context.getWorkflowStaticData("node");
  // Test and production registrations must never overwrite each other's IDs.
  const key = "subscription_" + createHash("sha256").update(url).digest("hex");
  return {
    client: createClient(credentials),
    state,
    key,
    url,
    credentials,
    options: { signal: AbortSignal.timeout(60000) },
  };
}
type Subscription = Awaited<ReturnType<typeof subscription>>;
function desired(context: IHookFunctions, s: Subscription) {
  return {
    Uri: s.url,
    Triggers: selectedTriggers(context.getNodeParameter("events")),
    SecretToken: webhookSecret(s.credentials.webhookSecret),
  };
}
async function findOwned(s: Subscription) {
  const saved = s.state[s.key] as IDataObject | undefined;
  if (typeof saved?.id === "string") {
    try {
      const hook = await s.client.webhooks.getWebhookById(
        { id: saved.id },
        s.options,
      );
      if (hook.Uri !== s.url)
        throw new Error(
          "Saved webhook belongs to a different URL; refusing to modify it",
        );
      return hook;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  const hooks = await s.client.webhooks.getWebhooks(s.options);
  const matches = hooks.filter((hook) => hook.Uri === s.url);
  if (matches.length > 1)
    throw new Error(
      "Multiple subscriptions use this n8n webhook URL. Remove duplicates before activation.",
    );
  if (matches[0]) s.state[s.key] = { id: matches[0].Id! };
  return matches[0];
}
function sameConfiguration(
  hook: { Triggers?: number[] | null; SecretToken?: string | null },
  body: ReturnType<typeof desired>,
) {
  return (
    hook.SecretToken === body.SecretToken &&
    JSON.stringify([...(hook.Triggers ?? [])].sort((a, b) => a - b)) ===
      JSON.stringify(body.Triggers)
  );
}
export const webhookMethods = {
  default: {
    async checkExists(this: IHookFunctions): Promise<boolean> {
      const s = await subscription(this);
      const body = desired(this, s);
      const hook = await findOwned(s);
      return Boolean(hook && sameConfiguration(hook, body));
    },
    async create(this: IHookFunctions): Promise<boolean> {
      const s = await subscription(this);
      const body = desired(this, s);
      const hook = await findOwned(s);
      if (hook) {
        if (!hook.Id)
          throw new Error("Clinica Web returned a webhook without an ID");
        if (!sameConfiguration(hook, body))
          await s.client.webhooks.updateWebhook(
            { id: hook.Id, body },
            s.options,
          );
        s.state[s.key] = { id: hook.Id };
      } else {
        const id = await s.client.webhooks.createWebhook({ body }, s.options);
        if (typeof id !== "string" || !id)
          throw new Error("Clinica Web did not return the created webhook ID");
        s.state[s.key] = { id };
      }
      return true;
    },
    async delete(this: IHookFunctions): Promise<boolean> {
      const s = await subscription(this);
      const hook = await findOwned(s);
      if (hook?.Id) {
        try {
          await s.client.webhooks.deleteWebhook({ id: hook.Id }, s.options);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      delete s.state[s.key];
      return true;
    },
  },
};
