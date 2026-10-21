import type { INodeProperties } from "n8n-workflow";
import {
  operations,
  resolveSchema,
  schemas,
  triggerOptions,
  type Schema,
} from "../../../shared/catalog/catalog";

// WebhookUpdateEvent members; verified against WebhookProvider's dispatch paths.
const payloadFields = [
  "Prerecord",
  "Prerecord",
  "Prerecord",
  "Patient",
  "Patient",
  "Order",
  "Order",
  "Order",
  "Order",
  "Protocol",
  "ReferralSalepackPackage",
  "ReferralSalepackPackage",
  "ReferralSalepackPackage",
  "ProtocolDrug",
  "ProtocolDrug",
  "ProtocolDrug",
  "ProtocolMonitoringAssignment",
  "ProtocolMonitoringAssignment",
  "ProtocolMonitoringAssignment",
];

function exampleValue(schema: Schema, ancestors: string[] = []): unknown {
  const shape = resolveSchema(schema);
  if (shape.enum) return shape.enum[0];
  if (schema.$ref && ancestors.includes(schema.$ref)) return null;
  const next = schema.$ref ? [...ancestors, schema.$ref] : ancestors;
  if (shape.type === "object")
    return Object.fromEntries(
      Object.entries(shape.properties ?? {}).map(([key, field]) => [
        key,
        exampleValue(field, next),
      ]),
    );
  if (shape.type === "array") return [];
  if (shape.type === "integer" || shape.type === "number") return 1;
  if (shape.type === "boolean") return false;
  if (shape.format === "date-time") return "2026-01-01T12:00:00Z";
  if (shape.format === "date") return "2026-01-01";
  if (shape.format === "uuid") return "00000000-0000-4000-8000-000000000001";
  return "example";
}

export const payloadReferences = triggerOptions.map((event) => {
  const field = payloadFields[Number(event.value)];
  const schema = schemas.WebhookUpdateEvent.properties?.[field];
  if (!schema) throw new Error(`Missing webhook payload schema: ${event.name}`);
  const shape = resolveSchema(schema);
  const fields = Object.entries(shape.properties ?? {}).map(([name, value]) => {
    const property = resolveSchema(value);
    return `${name}: ${property.type ?? "object"}${property.format ? ` (${property.format})` : ""}${property.nullable ? ", nullable" : ""}${shape.required?.includes(name) ? ", required" : ""}${property.description ? ` — ${property.description}` : ""}`;
  });
  const creation =
    operations.find((op) => op.id === "CreateWebhook")?.description ?? "";
  const eventName = event.name.replaceAll(" ", "");
  const eventDescription =
    creation
      .split("\n")
      .find((line) => line.includes(`${eventName} =`))
      ?.replace(/^\s*-\s*/, "") ?? event.name;
  return {
    event,
    field,
    description: `${eventDescription}. Payload: Trigger = ${event.value}, ${field}: ${schema.$ref?.split("/").pop()}. Unrelated payload fields may be absent or null. ${shape.description ?? ""}\n\n${fields.join("\n")}`,
    example: { Trigger: event.value, [field]: exampleValue(schema) },
  };
});

export function payloadProperties(): INodeProperties[] {
  return [
    {
      displayName: "Show Payload Reference",
      name: "showPayloadReference",
      type: "boolean",
      default: false,
      description:
        "Show the contract and a synthetic example for each selected event",
    },
    ...payloadReferences.flatMap(
      ({ event, description, example }): INodeProperties[] => {
        const displayOptions = {
          show: { showPayloadReference: [true], events: [event.value] },
        };
        return [
          {
            displayName: `${event.name} — Payload`,
            name: `payloadReference_${event.value}`,
            type: "string",
            typeOptions: { rows: 8 },
            noDataExpression: true,
            default: description,
            description:
              "Contract from the pinned SDK schema. This reference does not change the subscription or emitted data.",
            displayOptions,
          },
          {
            displayName: `${event.name} — Example JSON`,
            name: `payloadExample_${event.value}`,
            type: "string",
            typeOptions: { rows: 12 },
            noDataExpression: true,
            default: JSON.stringify(example, null, 2),
            description:
              "Synthetic example, not a received event. Copy into set mock data to design downstream nodes. Arrays are empty; real values and optional fields vary. Never use these placeholder IDs for API writes.",
            displayOptions,
          },
        ];
      },
    ),
  ];
}
