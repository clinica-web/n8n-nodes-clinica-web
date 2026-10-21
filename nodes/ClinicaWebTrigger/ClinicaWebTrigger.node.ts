import { createHash, timingSafeEqual } from "node:crypto";
import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
  type IWebhookFunctions,
  type IWebhookResponseData,
} from "n8n-workflow";
import { credentialName, credentialTest } from "../../shared/client/client";
import { triggerOptions } from "../../shared/catalog/catalog";
import {
  webhookMethods,
  webhookSecret,
  selectedTriggers,
} from "./subscription";

export class ClinicaWebTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Clinica Web Trigger",
    name: "clinicaWebTrigger",
    group: ["trigger"],
    version: 1,
    description: "Receive authenticated Clinica Web webhook events",
    defaults: { name: "Clinica Web Trigger" },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: credentialName,
        required: true,
        testedBy: "clinicaWebCredentialTest",
      },
    ],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "webhook",
      },
    ],
    properties: [
      {
        displayName:
          "Requires gambit:webhooks and a Webhook Secret in credentials. Subscription changes may take up to 5 minutes to apply.",
        name: "notice",
        type: "notice",
        default: "",
      },
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        required: true,
        options: triggerOptions,
        default: [0],
        description: "Events that start this workflow",
      },
    ],
  };
  methods = { credentialTest: { clinicaWebCredentialTest: credentialTest } };
  webhookMethods = webhookMethods;
  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const credentials = await this.getCredentials(credentialName);
    const secret = webhookSecret(credentials.webhookSecret);
    const supplied = this.getHeaderData()["x-clinicaweb-token"];
    const hash = (value: string) => createHash("sha256").update(value).digest();
    if (
      typeof supplied !== "string" ||
      !timingSafeEqual(hash(secret), hash(supplied))
    ) {
      this.getResponseObject().status(401).json({ error: "Unauthorized" });
      return { noWebhookResponse: true };
    }
    const body = this.getBodyData();
    if (
      typeof body.Trigger !== "number" ||
      !triggerOptions.some((event) => event.value === body.Trigger)
    ) {
      this.getResponseObject()
        .status(400)
        .json({ error: "Invalid Clinica Web event" });
      return { noWebhookResponse: true };
    }
    if (
      !selectedTriggers(this.getNodeParameter("events")).some(
        (event) => event === body.Trigger,
      )
    )
      return { webhookResponse: { received: true } };
    return { workflowData: [this.helpers.returnJsonArray(body)] };
  }
}
