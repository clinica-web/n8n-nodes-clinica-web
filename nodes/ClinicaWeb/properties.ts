import type { INodeProperties } from "n8n-workflow";
import {
  operations,
  label,
  resolveSchema,
  enumOptions,
  type Schema,
} from "../../shared/catalog/catalog";

function inputProperty(
  name: string,
  schema: Schema,
  description: string,
  required = false,
): INodeProperties {
  const shape = resolveSchema(schema);
  const property: INodeProperties = {
    displayName: label(name),
    name,
    type: "string",
    default: "",
    required,
    description: description || shape.description || `API field: ${name}`,
  };
  if (shape.enum && !schema.$ref?.endsWith("Flags"))
    return {
      ...property,
      type: "options",
      options: enumOptions(shape),
      default: shape.enum[0],
    };
  if (shape.type === "integer" || shape.type === "number")
    return {
      ...property,
      type: "number",
      default: 0,
      typeOptions: shape.type === "integer" ? { numberPrecision: 0 } : {},
    };
  if (shape.type === "boolean")
    return { ...property, type: "boolean", default: false };
  if (shape.type === "array" || shape.type === "object")
    return {
      ...property,
      type: "json",
      default: shape.type === "array" ? "[]" : "{}",
    };
  // Dates remain strings to preserve API offsets and date-only values.
  return {
    ...property,
    ...(shape.format ? { placeholder: shape.format } : {}),
  };
}
function bodyHelp(schema: Schema): string {
  const shape = resolveSchema(schema);
  const name = schema.$ref?.split("/").pop() ?? shape.type ?? "JSON";
  const fields = Object.entries(shape.properties ?? {}).map(([key, value]) => {
    const field = resolveSchema(value);
    return `${key}${shape.required?.includes(key) ? " (required)" : ""}: ${field.enum ? field.enum.join(" / ") : (field.type ?? "object")}${field.description ? ` — ${field.description}` : ""}`;
  });
  return `${name}. Preserve API field casing. ${fields.join("; ")}. Use an expression to pass an object or array. Server-side business validation applies.`;
}
export function nodeProperties(): INodeProperties[] {
  const resources = [...new Set(operations.map((op) => op.resource))].sort();
  const properties: INodeProperties[] = [
    {
      displayName: "Resource",
      name: "resource",
      type: "options",
      noDataExpression: true,
      options: resources.map((resource) => ({
        name: label(resource),
        value: resource,
      })),
      default: "online.clinics",
    },
  ];
  for (const resource of resources) {
    const entries = operations.filter((op) => op.resource === resource);
    properties.push({
      displayName: "Operation",
      name: "operation",
      type: "options",
      noDataExpression: true,
      displayOptions: { show: { resource: [resource] } },
      default: entries[0].id,
      options: entries.map((op) => ({
        name: label(op.id) + (op.deprecated ? " (Deprecated)" : ""),
        value: op.id,
        action: label(op.id),
        description: op.description || `${op.method} ${op.path}`,
      })),
    });
  }
  for (const op of operations) {
    const displayOptions = {
      show: { resource: [op.resource], operation: [op.id] },
    };
    properties.push({
      displayName: `${op.description ? `${op.description}\n\n` : ""}${op.method} ${op.path}\nScopes: ${op.scopes.join(" ") || "Not declared in Swagger; verify server permissions"}`,
      name: "operationInfo",
      type: "notice",
      default: "",
      displayOptions,
    });
    for (const parameter of op.parameters.filter((p) => p.required)) {
      properties.push({
        ...inputProperty(
          `arg_${parameter.name}`,
          parameter.schema,
          parameter.description,
          true,
        ),
        displayName: label(parameter.name),
        displayOptions,
      });
    }
    const optional = op.parameters.filter((p) => !p.required);
    if (optional.length)
      properties.push({
        displayName: "Optional Parameters",
        name: "optionalParameters",
        type: "collection",
        placeholder: "Add Parameter",
        default: {},
        displayOptions,
        options: optional.map((p) =>
          inputProperty(p.name, p.schema, p.description),
        ),
      });
    if (op.body) {
      const shape = resolveSchema(op.body.schema);
      const fields = Object.entries(shape.properties ?? {});
      const supportsFields = shape.type === "object" && fields.length > 0;
      if (supportsFields) {
        properties.push({
          displayName: "Body Input",
          name: "bodyMode",
          type: "options",
          noDataExpression: true,
          options: [
            { name: "JSON", value: "json" },
            { name: "Fields", value: "fields" },
          ],
          default: "json",
          description:
            "Choose schema fields or pass the entire body as JSON. Switching modes does not convert values. JSON remains the default for existing workflows.",
          displayOptions,
        });
        const fieldDisplay = {
          show: { ...displayOptions.show, bodyMode: ["fields"] },
        };
        for (const [name, schema] of fields.filter(([name]) =>
          shape.required?.includes(name),
        )) {
          properties.push({
            ...inputProperty(
              `body_${name}`,
              schema,
              resolveSchema(schema).description ?? "",
              true,
            ),
            displayName: label(name),
            displayOptions: fieldDisplay,
          });
        }
        const optionalFields = fields.filter(
          ([name]) => !shape.required?.includes(name),
        );
        if (optionalFields.length)
          properties.push({
            displayName: "Optional Body Fields",
            name: "bodyFields",
            type: "collection",
            placeholder: "Add Body Field",
            default: {},
            description:
              "Only added fields are sent. Nested objects and arrays accept JSON or expressions. Use JSON mode for explicit nulls or additional properties.",
            displayOptions: fieldDisplay,
            options: optionalFields.map(([name, schema]) =>
              inputProperty(
                name,
                schema,
                resolveSchema(schema).description ?? "",
              ),
            ),
          });
      }
      properties.push({
        displayName: "Body (JSON)",
        name: "body",
        type: "json",
        typeOptions: { rows: 8 },
        default: "{}",
        required: op.body.required,
        description: bodyHelp(op.body.schema),
        displayOptions: supportsFields
          ? { show: { ...displayOptions.show, bodyMode: ["json"] } }
          : displayOptions,
      });
    }
  }
  properties.push({
    displayName: "Request Timeout (Seconds)",
    name: "timeout",
    type: "number",
    default: 60,
    typeOptions: { minValue: 1 },
    description:
      "Covers token acquisition, the request and response consumption",
  });
  return properties;
}
