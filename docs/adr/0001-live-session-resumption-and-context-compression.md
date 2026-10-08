# 0001. Resume Gemini Live sessions from a server handle, and compress the context window

- Status: accepted
- Date: 2026-10-08
- Related: issue #5

## Context

A call is bridged from Twilio into a single Gemini Live session. The websocket to the Live API does
drop: in a long call the server sends `GoAway`, and transient network faults close it outright.

Until now the gateway handled that by opening a new session and pasting the transcript so far into
the system instruction, with a line telling Hachi to apologize for the interruption. That worked,
and it cost three things:

- **The audio context was lost.** How fast the resident was speaking, where they hesitated, the tone
  of the conversation — none of it survives a round trip through text. R3 measures exactly those
  things, so throwing them away mid-call is not a neutral loss.
- **The whole prompt was resent.** The persona, the safety rules, today's screening questions and
  the transcript, every time.
- **The resident heard about it.** Hachi apologized for a technical problem the person on the phone
  had no reason to notice.

There was also no bound on the context. A call is three to five minutes and is cut off at eight, so
in practice it never filled — but nothing said so, and nothing would have handled it if it had.

## Decision

Use the two mechanisms the Live API provides for this, rather than our own substitute.

**Transparent session resumption.** The connection asks for `sessionResumption: { transparent: true }`.
The server then sends resumption handles during the call, and the gateway keeps the most recent one
it marked resumable. On reconnect that handle is sent back and the server restores the conversation,
including the audio context. Handles offered while the model is generating come back as not
resumable and are ignored, because resuming from one loses part of the conversation.

**Sliding-window context compression.** `contextWindowCompression` is set to trigger at 16,000 tokens
and shorten to 8,000. Live audio costs roughly fifty tokens a second across both directions, so an
eight-minute call lands near thirty thousand; the window sits below that deliberately. An ordinary
call never reaches it. A long one is shortened at a user-turn boundary instead of failing when the
context fills. The system instruction is not part of the window, so the persona and the safety rules
survive compression.

**The old path stays, as a fallback.** If the server refuses the handle, the gateway drops it and
reconnects the way it used to, replaying the transcript into the prompt. The reconnect limit of
three sessions per call is unchanged.

**No apology on a resumed session.** `resumeCue` is now sent only on the fallback path. A resumed
session picks up mid-sentence, so there is nothing to apologize for. Because nothing is said on that
path, the silence timer (R4) is started explicitly at the point of reconnection instead of waiting
for a turn to end.

## What was verified, and what was not

This distinction matters more than the decision itself.

| | Status |
|---|---|
| `sessionResumption` and `contextWindowCompression` accepted by `@google/genai` 2.26.0 | Verified — present in the SDK's `LiveConnectConfig`, typechecks |
| Handle kept, sent back on reconnect, stale handles ignored, fallback on rejection | Verified — unit tests in `services/voice-gateway/test/` |
| The server actually restores a conversation from the handle | **Not verified.** Needs a real call with a forced disconnect; `docs/VERIFY_LIVE_AND_LEDGER.md` is the procedure |
| Compression actually triggers at 16,000 tokens and keeps the call alive | **Not verified, and not verifiable before 2026-10-18.** See below |

Accepting a parameter and honouring it are different things. Both rows above are worth having
anyway: the fallback means a handle the server will not take costs nothing, and the compression
settings only come into play in a case that previously had no handling at all.

### What a real call can now be asked

Until the logging went in, neither of the unverified rows could have been settled even by a call
that had already happened: the handle was stored silently and the reconnect paths were
indistinguishable afterwards. One line per call now carries the counts, and each reconnect says
which path it took. `docs/VERIFY_LIVE_AND_LEDGER.md` §5 has the queries.

| Question | Answerable from logs |
|---|---|
| Did the server issue a resumable handle, and how often | Yes — `handles`, plus a line on the first one |
| Were handles offered that it could not resume from | Yes — `unusableHandles` |
| Did a reconnect use a handle, or replay the transcript | Yes — `resumedFromHandle` / `replayedTranscript`, one line each |
| Did the server announce a disconnect first | Yes — `goAways`, from the `GoAway` message, which was previously discarded |
| How close did the context get to the compression trigger | Yes — `peakPromptTokens` |
| Did compression fire | **No.** Inference only |

### Compression cannot be reported, and probably cannot be reached

Every field of `LiveServerMessage` in 2.26.0 was checked. There are nine, and none of them says the
context window was compressed; `contextWindowCompression` exists only in the connect config. What
does arrive is `usageMetadata`, and because Live re-sends the whole session context on every turn,
its `promptTokenCount` is the size of that context. So the honest signals are the peak context size,
which is a fact, and the number of times it went down, which is a guess.

The arithmetic says it will not be reached either. Live audio is 25 tokens per second per direction,
so 16,000 tokens is 640 seconds of one side talking, or 320 seconds if both directions are counted
at once as this ADR originally assumed. `MAX_CONVERSATION_SEC` is 480 seconds and `loadConfig` will
not accept more than 900. A check-in call with an older adult is not 640 seconds of unbroken speech,
and raising the limit also raises what telephony reserves per call, since both services read the
same variable.

Submission material should therefore say that compression is configured and deliberately set above
what an ordinary call reaches, not that it has been seen to work.

## Alternatives considered

**Keep replaying the transcript.** Simplest, and already working. Rejected because it loses the
audio context, which is the part of the conversation this product measures.

**Non-transparent resumption.** Fewer messages from the server. Rejected because without
`lastConsumedClientMessageIndex` we cannot tell how much of the audio we sent was actually kept, so
we would have to either buffer everything or accept an unknown gap.

**A token trigger high enough never to fire.** Equivalent to not setting it, and dishonest about it.

## Consequences

- A dropped websocket mid-call becomes a gap of a second or two rather than a restarted conversation
  with an apology.
- The gateway has two reconnect paths to keep working. The fallback is covered by tests.
- The two "not verified" rows above need a real call before either can be claimed in a submission.
- A websocket that never drops cannot be observed reconnecting, so `FORCE_LIVE_DROP` closes one on
  purpose. It names the single resident it may interrupt, which is what makes a variable left behind
  after a test harmless, and `--set-env-vars` means the next ordinary deploy removes it.
