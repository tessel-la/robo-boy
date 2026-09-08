// Streaming transport helpers shared by every provider. Relocated from the former
// behaviorTree/agent/agentClient.ts (SSE/NDJSON parsing is not BT-specific).

export const readSse = async (
  response: Response,
  extract: (payload: any) => string | undefined,
  onToken?: (text: string) => void
): Promise<string> => {
  if (!response.body) throw new Error('The provider returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';
  let streamDone = false;
  const consumeBlock = (block: string) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      const token = extract(JSON.parse(data));
      if (token) {
        result += token;
        onToken?.(token);
      }
    }
  };
  while (!streamDone) {
    const { value, done } = await reader.read();
    streamDone = done;
    buffer += decoder.decode(value, { stream: !streamDone });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach(consumeBlock);
  }
  if (buffer.trim()) consumeBlock(buffer);
  return result;
};

export const readNdjson = async (
  response: Response,
  extract: (payload: any) => string | undefined,
  onToken?: (text: string) => void
): Promise<string> => {
  if (!response.body) throw new Error('The provider returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const payload = JSON.parse(trimmed);
    if (payload.error) throw new Error(String(payload.error));
    const token = extract(payload);
    if (token) {
      result += token;
      onToken?.(token);
    }
  };

  let streamDone = false;
  while (!streamDone) {
    const { value, done } = await reader.read();
    streamDone = done;
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach(consumeLine);
  }
  if (buffer.trim()) consumeLine(buffer);
  return result;
};

export const checkedFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const response = await fetch(url, init);
  if (response.ok) return response;
  const body = await response.text();
  let message = body;
  try {
    const payload = JSON.parse(body);
    message = typeof payload?.error === 'string' ? payload.error : (payload?.error?.message ?? body);
  } catch {
    /* keep raw body */
  }
  throw new Error(`${response.status} ${response.statusText}${message ? `: ${message.slice(0, 500)}` : ''}`);
};

export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const buffer =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error('Could not read recorded audio.'));
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(blob);
        });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};
