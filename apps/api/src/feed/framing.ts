/** Split a streamed NDJSON body into trimmed, non-empty lines. */
export async function* ndjsonLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
    }
  }
}

/**
 * Rejoins a JSON object the feed split across two lines (a stray newline
 * mid-object). A fragment the next line does not complete is given up on.
 */
export class LineFramer {
  private partial = '';

  reset(): void {
    this.partial = '';
  }

  /** `complete`: a line to normalize. `abandoned`: a fragment given up on. */
  push(line: string): { complete: string | null; abandoned: string | null } {
    let abandoned: string | null = null;
    if (this.partial) {
      const fragment = this.partial;
      this.partial = '';
      const joined = fragment + line;
      if (isJsonObject(joined)) return { complete: joined, abandoned: null };
      abandoned = fragment;
    }
    if (!isJsonObject(line) && line.startsWith('{') && !line.endsWith('}')) {
      this.partial = line;
      return { complete: null, abandoned };
    }
    return { complete: line, abandoned };
  }
}

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null;
  } catch {
    return false;
  }
}
