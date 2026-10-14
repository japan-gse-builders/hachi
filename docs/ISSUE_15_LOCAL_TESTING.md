# Issue #15: pauses and unanswered prompts

Branch: `codex/issue-15-live-turn-detection`. Based on main `7f21141`.

The implementation follows the latest issue comment and the owner's clarification in this chat:
wait 2.5 seconds after Hachi finishes playing, ask again; wait 4 seconds after that prompt,
ask again; wait 5 seconds after that prompt, ask again. After the third prompt has played,
wait a final 5 seconds for a reply. Continued silence is an R1 / Immediate action flag.
The last wait gives the person a chance to answer the third question.

This is an operational escalation policy, not a diagnosis. The case says the cause is unknown,
records either never speaking or stopping partway through, and contains no invented quote.
It is flagged immediately when the call ends; regular R1 notifications apply. Silence alone does
not trigger the medical-emergency conference bridge. Post-call analysis can make the same flag
if the immediate write failed. A saved case id prevents a duplicate, including after staff close it.
Older calls without the new escalation marker retain their existing R4 assessment. The model cannot skip an unanswered-check sequence with `end_call`, and saying goodbye does not erase the recorded silence reason.

## Try it locally

The running simulation is at <http://127.0.0.1:5191>.
It uses the real CallSession timer, MemoryStore and R1 detection/recording code.
The displayed prompts and playback acknowledgement are simulated. It makes no Gemini connection,
phone call, cloud write or notification delivery.

1. Select **Start silent call**, then leave it unanswered.
2. Watch the three prompts and their playback-finished events. Each 2.5/4/5-second wait starts
   after playback, rather than while Hachi is still speaking.
3. About 18 seconds after starting, **Outcome** should show `R1`, `emergency`, an explanation of
   the unanswered prompts, and an empty evidence array. The absence of words is the observation.
4. Start again. After the first prompt, select **Reply now**. The test call ends with **No R1 flag**.
5. Start again and select **End test** before the sequence is exhausted. This also creates no R1 flag.

This session's working folder is `/private/tmp/hachi-issue-15-20261013`. To restart from that branch root (Node 22.12+):

```sh
npm ci --registry=https://registry.npmjs.org --no-audit --no-fund
npm run preview:silence
```

## Settings

| Variable | Accepted values | Unset |
| --- | --- | --- |
| `LIVE_SILENCE_MS` | Integer, 500–2500 ms | No VAD override; Gemini default |
| `LIVE_END_OF_SPEECH_SENSITIVITY` | `low` or `high` | No sensitivity override |
| `SILENCE_PROMPT_INTERVALS_SEC` | 1–5 colon-separated waits, 0.5–120 seconds each | `2.5:4:5`; last wait is repeated after the final prompt |

The old `SILENCE_PROMPT_SEC` / `SILENCE_PROMPTS` pair still configures a fixed interval/count.
It cannot be combined with the new interval variable. Invalid values fail startup.
These variables are forwarded by the voice-gateway deployment script; no deployment was made here.

For example, this only changes the local preview's displayed Gemini setup, not real Gemini timing:

```sh
LIVE_SILENCE_MS=2500 LIVE_END_OF_SPEECH_SENSITIVITY=low npm run preview:silence -- 5193
```

The optional example uses port 5193 so it can run alongside the existing 5191 preview.

The connector sends the VAD fields under
`realtimeInputConfig.automaticActivityDetection` on the first connection and reconnects.
The locked SDK is `@google/genai` 2.26.0. Its types expose `silenceDurationMs` and
`endOfSpeechSensitivity` (`EndSensitivity`). The fields are documented in Google's
[SDK reference](https://googleapis.github.io/js-genai/release_docs/interfaces/types.AutomaticActivityDetection.html)
and [Live capabilities guide](https://ai.google.dev/gemini-api/docs/live-api/capabilities).
A typed connection test verifies the nesting and omission when unset. This does not establish the
model's actual timing on a telephone line.

## Real telephone comparison — still to run

Use a separate test deployment and your own consented test resident/phone. Use test staff/family
contacts too, because exhausting the prompts intentionally queues normal R1 notifications.
The synthetic local preview cannot validate Gemini or the 8 kHz μ-law telephone path.

1. Compare unset VAD with `LIVE_SILENCE_MS=1500`, then `2500`, keeping the same model,
   region and sensitivity. Restart the test gateway between settings.
2. In each call, say “I had breakfast … and then I watered the plants,” putting a roughly
   1-, 1.5- and 2-second pause at the ellipsis. Repeat in the languages you need to support.
   Listen for Hachi speaking before you finish. Also test a fully unanswered greeting.
3. Save the gateway's stereo WAV, with resident on the left and Hachi on the right.
4. From the branch root, measure each recording with the analyzer's existing energy VAD:

```sh
npm run build
LIVE_SILENCE_MS=1500 npm run measure:turns --workspace @hachi/voice-gateway -- /absolute/path/test-1500.wav
LIVE_SILENCE_MS=2500 npm run measure:turns --workspace @hachi/voice-gateway -- /absolute/path/test-2500.wav
```

The report gives the resident's speech end, Hachi's speech start, the intervening pause, any
speech overlap, and when the resident next speaks. Timing resolution is 20 ms. Listen to the
recording as well: noise, echo and model/server latency affect these measurements. Do not infer
that a requested 2500 ms was honoured merely because the connection accepted it.

Add the call ids, language, settings and measured pauses to `docs/TEST_RESULTS.md` after the trial.
No real telephone measurements have been claimed by this implementation.

## Verification completed

On this branch: 1,204 tests passed; 13 Firestore-emulator tests skipped. Coverage thresholds
passed (99.60% lines; 95.75% branches). Typechecking, service builds, the web production build
and deployment-script syntax checks passed. The headless browser verified prompt intervals,
R1 creation and cancellation on reply. Synthetic WAVs verified measured pauses/overlap;
these are not real-phone measurements.
