import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
const appSource = source('App.jsx');
const deviceChipSource = source('player/DeviceChip.jsx');
const expandedPlayerSource = source('player/ExpandedPlayer.jsx');

describe('local playback handoff removal', () => {
  it('does not render the remote now-playing handoff', () => {
    expect(appSource).not.toMatch(/remotePlaying|subscribeNowPlaying|getNowPlaying|Reproducir aquí|Reproduciendo en/);
  });

  it('keeps DeviceChip available in the normal player', () => {
    expect(deviceChipSource).toContain('export function DeviceChip');
    expect(expandedPlayerSource).toContain('<DeviceChip');
  });
});
