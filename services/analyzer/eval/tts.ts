/** Cloud Text-to-Speech with an on-disk cache, for the SYNTHETIC R3 evaluation only. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseWav } from '@hachi/core';
import { GoogleAuth } from 'google-auth-library';

export const TTS_SAMPLE_RATE = 8000;
const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

export interface Synthesizer {
  synth(voice: string, text: string, speakingRate: number): Promise<Int16Array>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CloudTts implements Synthesizer {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  requests = 0;
  cached = 0;

  constructor(
    private readonly cacheDir: string,
    private readonly project: string,
  ) {}

  async synth(voice: string, text: string, speakingRate: number): Promise<Int16Array> {
    const key = createHash('sha256').update(JSON.stringify([voice, speakingRate, TTS_SAMPLE_RATE, text])).digest('hex');
    const file = join(this.cacheDir, `${key}.wav`);
    let wav: Buffer;
    try {
      wav = await readFile(file);
      this.cached++;
    } catch {
      wav = await this.request(voice, text, speakingRate);
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(`${file}.tmp`, wav);
      await rename(`${file}.tmp`, file);
    }
    const audio = parseWav(wav);
    if (audio.sampleRate !== TTS_SAMPLE_RATE) throw new Error(`TTS returned ${audio.sampleRate} Hz`);
    return audio.channels[0]!;
  }

  private async request(voice: string, text: string, speakingRate: number): Promise<Buffer> {
    const body = JSON.stringify({
      input: { text },
      voice: { languageCode: voice.slice(0, 5), name: voice },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: TTS_SAMPLE_RATE, speakingRate },
    });
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken();
      this.requests++;
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': this.project, 'content-type': 'application/json' },
        body,
      });
      if (res.ok) {
        const json = (await res.json()) as { audioContent?: string };
        if (!json.audioContent) throw new Error('TTS returned no audio');
        return Buffer.from(json.audioContent, 'base64');
      }
      const retryable = res.status === 429 || res.status >= 500;
      // Chirp 3 HD has a per-minute request quota; waiting out a full minute is normal.
      if (!retryable || attempt >= 8) throw new Error(`TTS failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await sleep(Math.min(60_000, 2000 * 2 ** attempt) + Math.random() * 1000);
    }
  }
}
