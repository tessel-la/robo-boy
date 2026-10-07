import type { AssistantResponse } from './types';

export interface AgentObservation {
  call: unknown;
  result: unknown;
}

/** The existing JSON response protocol is shared by API, local-model and subscription transports.
 * Keep tool observations outside user history, and rebuild context each round after mutations. */
export async function runAssistantTurn(options: {
  signal: AbortSignal;
  checkCurrent(): void;
  request(observations: AgentObservation[]): Promise<string>;
  parse(raw: string): AssistantResponse;
  execute(response: AssistantResponse): Promise<unknown | undefined>;
  validate(response: AssistantResponse): string[];
}): Promise<AssistantResponse> {
  const observations: AgentObservation[] = [];
  let invalidResponses = 0;
  for (let round = 0; round < 12; round++) {
    options.signal.throwIfAborted();
    options.checkCurrent();
    const raw = await options.request(observations);
    options.signal.throwIfAborted();
    options.checkCurrent();
    let response: AssistantResponse;
    try {
      response = options.parse(raw);
    } catch (cause) {
      if (++invalidResponses > 2) throw cause;
      observations.push({ call: { invalidResponse: raw.slice(0, 2000) }, result: { error: cause instanceof Error ? cause.message : String(cause), instruction: 'Repair the response using the response contract.' } });
      continue;
    }
    const issues = options.validate(response);
    if (issues.length) {
      if (++invalidResponses > 2) throw new Error(`The proposal still has incomplete bindings: ${issues.join(' ')}`);
      observations.push({ call: response, result: { error: 'Proposal validation failed. Nothing was applied.', issues, instruction: 'Retrieve missing evidence if needed, then return a corrected complete proposal.' } });
      continue;
    }
    const result = await options.execute(response);
    options.signal.throwIfAborted();
    options.checkCurrent();
    if (result === undefined) return response;
    observations.push({ call: response, result });
  }
  throw new Error('The assistant reached its 12-round limit. No unfinished proposal was applied. Narrow the request or continue the task.');
}
