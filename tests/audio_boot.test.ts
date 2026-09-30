// Nothing audio loads before a sound is wanted. The page applies the
// player's settings at boot (src/game/settings.ts), and the volumes they
// set must wait on a bus that does not exist yet: building it there
// fetched the whole recorded bank, 231 files and about 2.9 MB, on every
// page load, the landing included. The match still builds it early
// (preloadSfx), so the first swing plays a recording.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let contexts = 0;
let fetches = 0;

// A WebAudio node as the bus wires it: connectable, with the params it sets.
function node(): Record<string, unknown> {
  const param = (): Record<string, unknown> => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
  });
  return {
    connect() {},
    disconnect() {},
    type: '',
    gain: param(),
    threshold: param(),
    knee: param(),
    ratio: param(),
    delayTime: param(),
    frequency: param(),
  };
}

class FakeAudioContext {
  destination = {};
  currentTime = 0;
  state = 'suspended';
  constructor() {
    contexts++;
  }
  createDynamicsCompressor = node;
  createGain = node;
  createDelay = node;
  createBiquadFilter = node;
  resume(): Promise<void> {
    return Promise.resolve();
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({});
  }
}

beforeEach(() => {
  // Fresh modules each time: the bus and the banks are module state.
  vi.resetModules();
  vi.unstubAllGlobals();
  contexts = 0;
  fetches = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('window', { addEventListener() {}, dispatchEvent() {} });
  vi.stubGlobal('fetch', async () => {
    fetches++;
    return new Response(null, { status: 404 });
  });
});

describe('audio at boot', () => {
  it('applies the settings without an audio context or a download', async () => {
    const { getSettings, updateSettings } = await import('../src/game/settings');
    const { setMusicVolume } = await import('../src/game/music');
    const { setSfxVolume } = await import('../src/game/sfx');
    getSettings();
    updateSettings({ music: 0.4, sfx: 0.5, announcer: false });
    setMusicVolume(0.2);
    setSfxVolume(0.3);
    expect(contexts).toBe(0);
    expect(fetches).toBe(0);
  });

  it('still builds the bus and starts the bank when a match asks', async () => {
    const { getSettings } = await import('../src/game/settings');
    const { preloadSfx } = await import('../src/game/sfx');
    getSettings();
    preloadSfx();
    preloadSfx();
    expect(contexts).toBe(1);
    expect(fetches).toBeGreaterThan(0);
  });
});
