import { describe, expect, it } from 'vitest';
import officialConfig from '../../config/panel-sources.official.json';
import { OFFICIAL_PANEL_SOURCE } from './constants';

describe('OFFICIAL_PANEL_SOURCE', () => {
  it('matches config/panel-sources.official.json exactly', () => {
    expect(officialConfig.sources).toEqual([OFFICIAL_PANEL_SOURCE]);
  });
});
