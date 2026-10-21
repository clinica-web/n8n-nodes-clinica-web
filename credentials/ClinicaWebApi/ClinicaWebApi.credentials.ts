import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class ClinicaWebApi implements ICredentialType {
  name = "clinicaWebApi";
  displayName = "Clinica Web API";
  documentationUrl =
    "https://medakadem.freshdesk.com/uk/support/solutions/articles/77000530947";
  properties: INodeProperties[] = [
    {
      displayName: "API URL",
      name: "baseUrl",
      type: "string",
      default: "",
      required: true,
      placeholder: "https://your-clinic.medakadem.com.ua",
      description: "Clinica Web deployment URL",
    },
    {
      displayName: "Token URL",
      name: "tokenUrl",
      type: "string",
      default: "https://id.medakadem.com/connect/token",
      required: true,
    },
    {
      displayName: "Grant Type",
      name: "grantType",
      type: "hidden",
      default: "client_credentials",
    },
    {
      displayName: "Client ID",
      name: "clientId",
      type: "string",
      default: "",
      required: true,
    },
    {
      displayName: "Client Secret",
      name: "clientSecret",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
    },
    {
      displayName: "Scopes",
      name: "scopes",
      type: "string",
      default: "gambit:static_data",
      required: true,
      description:
        "Space-separated exact scopes granted to this client. Add gambit:webhooks for webhook operations. Wildcards such as gambit:erp* are not OAuth scopes.",
    },
    {
      displayName: "Webhook Secret",
      name: "webhookSecret",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description:
        "Required by the Trigger. Choose a long random secret; incoming X-ClinicaWeb-Token must match. Reactivate workflows after changing it.",
    },
  ];
}
