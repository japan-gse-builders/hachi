import { readFile } from 'node:fs/promises';
import { measureTurnPauses } from '../dist/turnTiming.js';
const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: npm run measure:turns --workspace @hachi/voice-gateway -- recording.wav');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify({
      recording: path,
      configuredSilenceMs: process.env.LIVE_SILENCE_MS || 'model default',
      measuredPauses: measureTurnPauses(await readFile(path)),
      note: 'Acoustic timing, at 20 ms resolution. Review the recording to judge interruptions; this does not prove the model honoured its VAD setting.',
    }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
