import { describe, expect, it } from 'vitest';
import { matchContextOptions } from './automaticTags';

describe('automatic XR context tagging', () => {
  const options = [
    { id: 'camera', label: 'Camera' },
    { id: 'topic', label: '/camera/image' },
    { id: 'pad', label: 'Drive Pad' },
  ];
  it('matches spoken labels case-insensitively and exact ROS paths, keeping duplicate ids once', () => {
    expect(
      matchContextOptions('Show the DRIVE PAD next to Camera with /camera/image.', [...options, options[2]]).map(
        o => o.id
      )
    ).toEqual(['topic', 'pad', 'camera']);
  });
  it('does not guess duplicate names or match substrings of a path/word', () => {
    expect(matchContextOptions('Cameraman and /camera/image_extra', options)).toEqual([]);
    expect(matchContextOptions('Camera', [...options, { id: 'other-camera', label: 'Camera' }])).toEqual([]);
  });
  it('escapes punctuation and bounds selections', () => {
    expect(matchContextOptions('Read a+b (test)', [{ id: 'a', label: 'a+b (test)' }])).toHaveLength(1);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, label: `resource${i}` }));
    expect(matchContextOptions(many.map(o => o.label).join(' '), many)).toHaveLength(8);
  });
});
