import { describe, expect, it } from 'vitest';
import { parseContextReads } from './contextTool';
describe('context read boundary', () => {
  it('accepts discovered names and strips undeclared input', () => {
    expect(parseContextReads([{ kind: 'schema', resource: 'action', name: '/home', execute: true }])).toEqual([{ kind: 'schema', resource: 'action', name: '/home' }]);
  });
  it.each([[], Array(7).fill({ kind: 'graph' }), [{ kind: 'publish', name: '/cmd_vel' }], [{ kind: 'schema', resource: 'parameter', name: '/x' }], [{ kind: 'topic', name: '' }]])('rejects invalid or executable requests: %j', value => {
    expect(() => parseContextReads(value)).toThrow();
  });
});
