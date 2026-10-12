import { parseWav, speechSegments } from '@hachi/core';

/** Same 20 ms energy VAD used by the analyzer; channel 0 is resident, channel 1 is Hachi. */
export function measureTurnPauses(wav: Buffer) {
  const audio = parseWav(wav);
  if (audio.channels.length !== 2) throw new Error('Expected a stereo Hachi recording: resident left, Hachi right');
  const resident = speechSegments(audio.channels[0]!, audio.sampleRate);
  const agent = speechSegments(audio.channels[1]!, audio.sampleRate, { bridgeMs: 800 });
  return agent.flatMap((a) => {
    const preceding = resident.filter((r) => r.startMs < a.startMs).at(-1);
    if (!preceding) return [];
    const next = resident.find((r) => r.startMs >= a.startMs);
    return [{
      residentEndMs: preceding.endMs, agentStartMs: a.startMs,
      pauseMs: Math.max(0, a.startMs - preceding.endMs),
      overlapMs: Math.max(0, preceding.endMs - a.startMs),
      nextResidentStartMs: next?.startMs ?? null,
    }];
  });
}
