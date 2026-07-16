export class JsonBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonBodyError";
  }
}

export async function readBoundedJsonObject(
  request: Request,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new JsonBodyError("The request body must use application/json.");
  }

  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
    throw new JsonBodyError("The request body is too large.");
  }
  if (!request.body) {
    throw new JsonBodyError("The request body must be valid JSON.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("request body limit exceeded");
        throw new JsonBodyError("The request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new JsonBodyError("The request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonBodyError("The request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}
