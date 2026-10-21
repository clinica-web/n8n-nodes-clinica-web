import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ClinicaClient, RequestOptions } from "@clinica-web/sdk";
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
} from "n8n-workflow";
import {
  operationsById,
  resolveSchema,
  type Operation,
  type Schema,
} from "../../shared/catalog/catalog";
import {
  createClient,
  credentialName,
  errorMessage,
} from "../../shared/client/client";

function parseJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${field} must contain valid JSON`);
  }
}
function validateInput(value: unknown, schema: Schema, field: string): unknown {
  const shape = resolveSchema(schema);
  if (value === null && shape.nullable) return value;
  if (
    shape.type === "object" &&
    (!value || typeof value !== "object" || Array.isArray(value))
  )
    throw new Error(`${field} must be an object`);
  if (shape.type === "array" && !Array.isArray(value))
    throw new Error(`${field} must be an array`);
  if (
    shape.type === "integer" &&
    (typeof value !== "number" || !Number.isSafeInteger(value))
  )
    throw new Error(`${field} must be a safe integer`);
  if (
    shape.type === "number" &&
    (typeof value !== "number" || !Number.isFinite(value))
  )
    throw new Error(`${field} must be a finite number`);
  if (shape.type === "string" && typeof value !== "string")
    throw new Error(`${field} must be a string`);
  if (shape.type === "boolean" && typeof value !== "boolean")
    throw new Error(`${field} must be a boolean`);
  if (
    shape.enum &&
    !schema.$ref?.endsWith("Flags") &&
    !shape.enum.includes(value as number | string)
  )
    throw new Error(`${field} must be one of the documented enum values`);
  return value;
}
function readArguments(
  context: IExecuteFunctions,
  op: Operation,
  index: number,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const optional = context.getNodeParameter(
    "optionalParameters",
    index,
    {},
  ) as Record<string, unknown>;
  for (const p of op.parameters) {
    const value = p.required
      ? context.getNodeParameter(`arg_${p.name}`, index)
      : optional[p.name];
    if (value === undefined) continue;
    if (p.required && (value === "" || value === null))
      throw new Error(`${p.name} is required`);
    const shape = resolveSchema(p.schema);
    const parsed =
      shape.type === "object" || shape.type === "array"
        ? parseJson(value, p.name)
        : value;
    args[p.name] = validateInput(parsed, p.schema, p.name);
  }
  if (op.body) {
    const mode = context.getNodeParameter("bodyMode", index, "json");
    if (mode === "fields") {
      const shape = resolveSchema(op.body.schema);
      if (
        shape.type !== "object" ||
        !Object.keys(shape.properties ?? {}).length
      )
        throw new Error("This body supports JSON input only");
      const optional = context.getNodeParameter(
        "bodyFields",
        index,
        {},
      ) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const [name, schema] of Object.entries(shape.properties ?? {})) {
        const required = shape.required?.includes(name);
        const value = required
          ? context.getNodeParameter(`body_${name}`, index, undefined)
          : optional[name];
        if (value === undefined) {
          if (required) throw new Error(`Body.${name} is required`);
          continue;
        }
        const field = resolveSchema(schema);
        body[name] = validateInput(
          field.type === "object" || field.type === "array"
            ? parseJson(value, `Body.${name}`)
            : value,
          schema,
          `Body.${name}`,
        );
      }
      args[op.body.name] = body;
      return args;
    }
    if (mode !== "json") throw new Error("Select a valid body input mode");
    const raw = context.getNodeParameter("body", index, "");
    if (raw !== "" && raw !== undefined) {
      // A JSON body can also be a primitive (e.g. a JSON string or enum).
      args[op.body.name] = validateInput(
        parseJson(raw, "Body"),
        op.body.schema,
        "Body",
      );
    } else if (op.body.required) throw new Error("Body is required");
  }
  return args;
}
export async function invokeOperation(
  client: ClinicaClient,
  op: Operation,
  args: Record<string, unknown>,
  options: RequestOptions,
): Promise<unknown> {
  const parts = op.sdkMethod.split(".");
  let target: unknown = client;
  for (const part of parts.slice(0, -1))
    target = (target as Record<string, unknown>)[part];
  const method = (target as Record<string, unknown>)[parts.at(-1)!] as (
    ...params: unknown[]
  ) => Promise<unknown>;
  return method.call(
    target,
    ...(op.hasArguments ? [args, options] : [options]),
  );
}
function jsonItem(value: unknown, index: number): INodeExecutionData {
  let json: IDataObject;
  if (value === undefined) json = { success: true };
  else if (value !== null && typeof value === "object" && !Array.isArray(value))
    json = value as IDataObject;
  else json = { value: value as IDataObject["value"] };
  return { json, pairedItem: { item: index } };
}
export async function execute(
  this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
  const client = createClient(await this.getCredentials(credentialName));
  const result: INodeExecutionData[] = [];
  const inputCount = this.getInputData().length;
  for (let index = 0; index < inputCount; index++) {
    this.getExecutionCancelSignal()?.throwIfAborted();
    try {
      const id = this.getNodeParameter("operation", index) as string;
      const op = operationsById.get(id);
      if (!op || op.resource !== this.getNodeParameter("resource", index))
        throw new Error("Select a valid Clinica Web resource and operation");
      const timeout = this.getNodeParameter("timeout", index, 60) as number;
      if (!Number.isFinite(timeout) || timeout <= 0)
        throw new Error("Timeout must be a positive number");
      const signals = [
        AbortSignal.timeout(Math.min(Math.ceil(timeout * 1000), 2147483647)),
      ];
      const cancel = this.getExecutionCancelSignal();
      if (cancel) signals.push(cancel);
      const value = await invokeOperation(
        client,
        op,
        readArguments(this, op, index),
        { signal: AbortSignal.any(signals) },
      );
      if (op.binary) {
        const response = value as Response;
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Clinica Web returned HTTP ${response.status}`);
        }
        if (!response.body)
          throw new Error("Clinica Web returned an empty file response");
        const mimeType =
          response.headers.get("content-type")?.split(";")[0] ??
          "application/octet-stream";
        const fileName = `${op.id}.${mimeType === "application/pdf" ? "pdf" : "bin"}`;
        const stream = Readable.fromWeb(
          response.body as NodeReadableStream<Uint8Array>,
        );
        try {
          const binary = await this.helpers.prepareBinaryData(
            stream,
            fileName,
            mimeType,
          );
          result.push({
            json: { fileName, mimeType },
            binary: { data: binary },
            pairedItem: { item: index },
          });
        } finally {
          stream.destroy();
        }
      } else {
        for (const row of Array.isArray(value) ? value : [value])
          result.push(jsonItem(row, index));
      }
    } catch (error) {
      const message = errorMessage(error);
      if (this.continueOnFail())
        result.push({ json: { error: message }, pairedItem: { item: index } });
      else
        throw new NodeOperationError(this.getNode(), message, {
          itemIndex: index,
        });
    }
  }
  return [result];
}
