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
| The server actually restores a conversation from the handle | **Not verified.** Needs a real call with a forced disconnect |
| Compression actually triggers at 16,000 tokens and keeps the call alive | **Not verified.** No call has run long enough |

Accepting a parameter and honouring it are different things. Both rows above are worth having
anyway: the fallback means a handle the server will not take costs nothing, and the compression
settings only come into play in a case that previously had no handling at all.

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
