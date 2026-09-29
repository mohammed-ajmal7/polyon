/**
 * Reads a request body as UTF-8 text, stopping as soon as it exceeds `maxBytes`.
 * Returns undefined when the body is too large, without buffering the rest of it.
 */
export async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}
