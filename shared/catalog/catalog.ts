import operationsJson from "./operations.json";
import schemasJson from "./schemas.json";

export interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  nullable?: boolean;
  enum?: Array<string | number>;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
}
export interface Operation {
  id: string;
  resource: string;
  sdkMethod: string;
  hasArguments: boolean;
  method: string;
  path: string;
  scopes: string[];
  description: string;
  deprecated: boolean;
  parameters: Array<{
    name: string;
    wireName: string;
    location: string;
    required: boolean;
    schema: Schema;
    description: string;
  }>;
  body?: { name: string; required: boolean; schema: Schema };
  binary: boolean;
}
export const operations = operationsJson as Operation[];
export const schemas = schemasJson as Record<string, Schema>;
export const operationsById = new Map(
  operations.map((operation) => [operation.id, operation]),
);
export function resolveSchema(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const resolved = schemas[schema.$ref.split("/").pop()!];
  if (!resolved) throw new Error(`Unknown schema: ${schema.$ref}`);
  return { ...resolved, ...schema, $ref: undefined };
}
export function label(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]/g, " ")
    .replace(/^./, (s) => s.toUpperCase());
}
export function enumOptions(
  schema: Schema,
): Array<{ name: string; value: string | number }> {
  return (schema.enum ?? []).map((value) => {
    const description = schema.description
      ?.split("\n")
      .find((line) => line.includes("`" + value + "`:"));
    return {
      name: description
        ? label(description.split("`:")[1].trim())
        : String(value),
      value,
    };
  });
}
export const triggerOptions = enumOptions(schemas.WebhookTriggers);
