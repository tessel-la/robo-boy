import { BehaviorTreeAgentRequest } from './types';

const SCHEMA = `Default behavior: act autonomously and return a finished tree. Return ONLY one JSON object with this shape:
{"name":"tree name","description":"short purpose","blackboardDefaults":{},"nodes":[{"id":"unique-id","type":"sequence|selector|parallel|retry|repeat|timeout|ifElse|action|service|topic|subscriber|subtree","label":"visible label","config":{},"tree":{...only for subtree}}],"edges":[{"source":"parent-id","target":"child-id","sourceHandle":"then|else only for ifElse"}]}
Action config: {"actionName":"/name","actionType":"pkg/action/Type","parameters":{},"timeout":number,"inputBindings":[{"variable":"name","targetPath":"field.path"}],"outputBindings":[{"sourcePath":"field.path","variable":"name"}]}.
Service config: {"serviceName":"/name","serviceType":"pkg/srv/Type","request":{},"timeout":number,"inputBindings":[],"outputBindings":[]}.
Publisher topic config: {"topicName":"/name","messageType":"pkg/msg/Type","message":{},"publishOnce":true,"frequencyHz":number,"durationMs":number,"inputBindings":[]}.
Subscriber config: {"topicName":"/name","messageType":"pkg/msg/Type","timeout":10000,"outputBindings":[{"sourcePath":"field.path","variable":"name"}]}.
Timeout config: {"timeout":10000}. If/else config: {"variable":"blackboardName","operator":"truthy|falsy|equals|notEquals|greaterThan|greaterThanOrEqual|lessThan|lessThanOrEqual|exists","expectedValue":any}; connect its branches with sourceHandle "then" and "else".
Retry/repeat config: {"iterationLimit":3}. A subtree node must contain a complete nested tree object in "tree".
Edges are directed parent-to-child. Every non-root node should have one parent. Child edge array order is execution order. Use only resources supplied in context unless the user explicitly asks for placeholders.
For every action and service, fill the complete parameters/request object from its supplied schema and defaults. Movement values such as x, y, z, yaw, distance, displacement, frame, and relative mode must reflect the user's request; do not silently omit them.
Use blackboardDefaults and bindings when data must flow between subscriber, action, service, publisher, or if/else nodes. Do not invent bindings when static values are sufficient.
Make reasonable assumptions instead of asking about routine details. In particular:
- Map forward/backward to x and left/right to y using the robot context; when none is supplied, use ROS convention (+x forward, +y left, +z up).
- Treat a requested displacement as relative motion, set unspecified displacement axes to 0, preserve/current-or-default yaw when unspecified, and use every remaining schema default.
- Infer retries, timeout, tolerances, and optional values from context or safe defaults.
- Put important assumptions in the tree description so the user can inspect them.
Clarification is an exceptional fallback. Use it only when no safe executable tree can be produced because a truly safety-critical choice or the intended action itself is unknowable. Never ask about a field that has a schema default or a reasonable neutral value. If absolutely blocked, return ONLY {"kind":"clarification","question":"one short specific question","missing":["field"],"suggestions":["recommended concise answer","alternative"]}. Ask at most once in the entire conversation; if the agent has already asked a question, make the best remaining assumptions and finish the tree. Do not include markdown.`;

export const buildBehaviorTreeAgentPrompt = (request: BehaviorTreeAgentRequest): string => {
  const resources = request.rosResources;
  const resourceContext = {
    actions: resources.actions,
    services: resources.services,
    topics: resources.topics,
  };
  const parts = [
    'You are a robotics behavior-tree architect. Build an executable behavior tree for the request.',
    SCHEMA,
    request.settings.systemContext && `Additional agent instructions:\n${request.settings.systemContext}`,
    request.settings.robotContext && `Robot and mission context:\n${request.settings.robotContext}`,
    `Available ROS resources:\n${JSON.stringify(resourceContext)}`,
    `Action and service input schemas (keyed by ROS type):\n${JSON.stringify(request.resourceSchemas)}`,
    request.settings.includeCurrentTree && request.currentTree
      ? `Behavior-tree context selected by the user:\n${JSON.stringify(request.currentTree)}`
      : '',
    request.conversation?.length
      ? `Conversation so far:\n${request.conversation.map(message => `${message.role}: ${message.content}`).join('\n')}`
      : '',
    `Latest user message:\n${request.prompt}`,
  ];
  return parts.filter(Boolean).join('\n\n');
};

const readSse = async (
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

const checkedFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const response = await fetch(url, init);
  if (response.ok) return response;
  const body = await response.text();
  let message = body;
  try { message = JSON.parse(body)?.error?.message ?? body; } catch { /* keep raw body */ }
  throw new Error(`${response.status} ${response.statusText}${message ? `: ${message.slice(0, 500)}` : ''}`);
};

export const generateBehaviorTree = async (request: BehaviorTreeAgentRequest): Promise<string> => {
  const { settings, signal, onProgress, onToken } = request;
  const prompt = buildBehaviorTreeAgentPrompt(request);
  onProgress?.(`Contacting ${settings.provider} (${settings.model})…`);

  if (settings.provider === 'gemini') {
    const url = `${settings.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(settings.model)}:streamGenerateContent?alt=sse`;
    const response = await checkedFetch(url, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    });
    onProgress?.('Receiving and assembling the tree…');
    return readSse(response, payload => payload.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join(''), onToken);
  }

  const url = `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const response = await checkedFetch(url, {
    method: 'POST', signal, headers,
    body: JSON.stringify({ model: settings.model, stream: true, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
  });
  onProgress?.('Receiving and assembling the tree…');
  return readSse(response, payload => payload.choices?.[0]?.delta?.content, onToken);
};
