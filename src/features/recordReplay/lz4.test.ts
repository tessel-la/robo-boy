import { describe, expect, it } from 'vitest';
import { decompressLz4Frame } from './lz4';

const text = (value: string, times: number) => new TextEncoder().encode(value.repeat(times));
const random = (length: number) => {
  const bytes = new Uint8Array(length);
  let state = 42;
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    bytes[index] = (state >> 16) & 255;
  }
  return bytes;
};
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => (result.set(part, offset), offset + part.length), 0);
  return result;
};
const decode = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

// Frames produced by the reference implementation (python-lz4) from the expected data below.
const FRAMES: Record<string, string> = {
  'repeating, multi-block, with checksums': 'BCJNGFxA2MoCAAAAAAB+GgEAAD9hYmMDAP//////////////rZ9yb2JvLWJveSAJAP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////HFAgcm9ib/wMHyEKAQAAD0T0/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+hQb3kgcm9YrsL11QAAAA8JAP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////i1AtYm95IAyGcOEAAAAA5m+9Ng==',
  'incompressible, stored block': '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',
  'mixed, independent blocks': 'BCJNGGBAggsCAAAfeAEAAP//6omJpXUgRW2EYYFUEu7UtTBFC7fjmdSOsG4vd+n3lXG6L+W887kSE5N4jqkY7nXkiVZ62z+AkpF3b2LvmbNpg0aH7fskq6dfaQAtEijlI4ZeUyLCvLpjlTKbNJdA4hfl/Am6mOLtmwpebnfIG8p3VQm3GqQwQuFTOGq8qbR7N04yLGTNA3iHyss8hALHlQkH4fd7uXUOooThVRNbz3dheEJoAtBhQwNYBuJs+gY/cVY+jV05YhY+3oXTUedozSwZgjau2tNGpmxp10bnr79G+Hnx11zQU04afV2Ng1d1MepMDX0kMnoJvkuTKgGaDiGm6JoDWZW8avAfauBodGgIo/hmiuRU1sQGBI8yf58jmRnlAPdqi0kqGMVyYs6Xnkj93LjrUxNTb/ztQnSbl/dHB8ecy8WI8yVKxu4r7ZkOiq5SfLmpRuihWFwlCYxZgcMp5uaYpGay9D16VlL9UbBmb7ApDB7FjvPSq68Iiby6pTebVHY9/Hwvqzog8DaXfXP4UDf76mg8/CExWYvLmpiE6TxhfcojTG5LXMcc0ENsSgGJH59FCOtW/0aaqIvLFvn3I4LEgbEYSNU6wfADLXWDQrRZEGZ7kpcjQ+p3/yUqmxinMWSbgNhVACuGgQYukrVyJ1tlh5spV0R+whFggswEBiDmdVFnYWJhYgQA//8+UGJhYmFiAAAAAA==',
};
const EXPECTED: Record<string, Uint8Array> = {
  'repeating, multi-block, with checksums': join(text('abc', 1000), text('robo-boy ', 20000)),
  'incompressible, stored block': random(2000),
  'mixed, independent blocks': join(text('x', 20), random(500), text('ab', 300)),
};

describe('decompressLz4Frame', () => {
  it.each(Object.keys(FRAMES))('matches the reference encoder: %s', name => {
    expect(decompressLz4Frame(decode(FRAMES[name]), EXPECTED[name].length)).toEqual(EXPECTED[name]);
  });

  it('rejects data that does not match the declared size', () => {
    const frame = decode(FRAMES['mixed, independent blocks']);
    expect(() => decompressLz4Frame(frame, 1000)).toThrow();
    expect(() => decompressLz4Frame(new Uint8Array([1, 2, 3, 4, 5]), 5)).toThrow('not an LZ4 frame');
  });
});
