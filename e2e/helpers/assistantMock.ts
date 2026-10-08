/** Native OpenAI-compatible tool wire format. Domain shapes describe test operations only;
 * the app receives tool_calls and sends their paired results back to the model. */
export function assistantStream(response: Record<string, any>, thinking?: string): string {
  const event = (value: object) =>
    `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, ...value }] })}\n\n`;
  const explanation = response.kind === 'explanation' || response.kind === 'clarification';
  const calls =
    response.kind === 'contextRequest'
      ? response.reads.map((read: Record<string, any>) => {
          const { kind, ...input } = read;
          return { name: `read_${kind}`, input };
        })
      : response.kind === 'tool'
        ? [{ name: response.name, input: response.input }]
        : [
            {
              name: (
                {
                  workspaceEdit: 'edit_workspace',
                  padProposal: 'propose_pad',
                  tree: 'propose_tree',
                  rosAction: 'propose_operation',
                } as Record<string, string>
              )[response.kind],
              input:
                response.kind === 'tree'
                  ? { tree: response }
                  : Object.fromEntries(
                      Object.entries(response).filter(([key]) => !['kind', 'summary', 'followUp'].includes(key))
                    ),
            },
          ];
  return (
    (thinking ? event({ delta: { reasoning_content: thinking } }) : '') +
    event(
      explanation
        ? { delta: { content: response.message ?? response.question }, finish_reason: 'stop' }
        : {
            delta: {
              tool_calls: calls.map((call: { name: string; input: unknown }, index: number) => ({
                index,
                id: `call_${crypto.randomUUID()}_${index}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            },
            finish_reason: 'tool_calls',
          }
    ) +
    'data: [DONE]\n\n'
  );
}
