import { monoWav } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { measureTurnPauses } from '../src/turnTiming.js';
function stereo(overlap = false) {
  const interleaved = new Int16Array(8000 * 3 * 2);
  for (let i = 0; i < 8000 * 3; i++) {
    if ((i >= 4000 && i < (overlap ? 20000 : 8000)) || (i >= 17600 && i < 20000)) interleaved[i * 2] = 5000;
    if (i >= 12800 && i < 14400) interleaved[i * 2 + 1] = 5000;
  }
  const wav = monoWav(interleaved, 8000);
  wav.writeUInt16LE(2, 22); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(4, 32);
  return wav;
}
describe('phone-recording pause measurements', () => {
  it('measures the pause before Hachi starts and the next resident speech', () => {
    expect(measureTurnPauses(stereo())).toEqual([{ residentEndMs: 1000, agentStartMs: 1600, pauseMs: 600, overlapMs: 0, nextResidentStartMs: 2200 }]);
  });
  it('reports overlap rather than disguising an interruption as silence', () => {
    expect(measureTurnPauses(stereo(true))[0]).toMatchObject({ pauseMs: 0, overlapMs: 900 });
  });
  it('rejects mono audio because the speakers cannot be distinguished', () => {
    expect(() => measureTurnPauses(monoWav(new Int16Array(8000), 8000))).toThrow(/stereo/);
  });
});
