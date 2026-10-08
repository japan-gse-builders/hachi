# 0002. Do not dial a call we already know cannot work

- Status: accepted
- Date: 2026-10-08
- Related: issue #19, ADR 0001

## Context

On 2026-10-08 residents heard this three times a day:

> "I'm sorry, we're having a technical problem. We will call you back in a few minutes. Goodbye."

The cause was outside the repository. Cloud Logging for `hachi-voice-gateway`:

```
msg=Gemini Live session closed unexpectedly
reason=closed: 1008 Spend cap breached for project: projects/871712096742
        for service: aiplatform.googleapis.com
```

A Google Cloud **Spend Cap** on Vertex AI had been breached. Nothing in the code or the
configuration changed: over the same thirty days of logs, every `conversation ended` from 10-02 to
10-07 reads `agent`, `resident` or `emergency`, and every one on 10-08 reads `gateway_error`.

What makes this worth an ADR is not the cap. It is that **dialing does not depend on Gemini.**
Twilio rang the phone perfectly while Vertex AI was refusing the project, so the resident answered,
heard nothing, and was apologized to by Twilio's own `<Say>` — which is precisely why the apology
still worked when everything that was supposed to talk to them did not.

Then the retry ladder ran. Three Live sessions per media stream (`maxLiveSessions`), three media
streams per call (`MAX_STREAMS`), three call attempts per day (`MAX_CALL_ATTEMPTS`): twenty-seven
attempts at the same impossible thing, and three separate times that an eighty-five-year-old's
phone rang and apologized to them.

The operator's objection is the whole design input, and it is correct:

> 技術的な問題があることがわかっているのであれば、ユーザに電話すべきではない

Ringing and apologizing is worse than not ringing. A resident cannot tell a broken service from a
real emergency callback, and three times a day is distressing rather than merely useless.

Two further gaps, both independent of the cause:

- **No case was created**, and should not have been. `r4Detection` only fires on
  `silent_after_greeting` or `stopped_responding`. Our outage is not the resident's health event,
  and filing it as one would put our failures in their clinical record.
- **Staff saw nothing.** `failure` was written to Firestore and read by no one. A check-in service
  that quietly stops checking in is the exact failure mode the product exists to prevent, and it
  was invisible on every screen.

## Decision

### Judge the fault, not the call

The Live API delivers a spend cap and a dropped socket as the same thing: a websocket close. The
close reason is the only thing that distinguishes them, and the distinction decides whether a retry
is worth a phone ringing. `classifyGatewayFailure` reads the reason and answers `systemic` or
`transient`. Unrecognized is transient, deliberately: being wrong that way costs a few rings before
the transient threshold stops them anyway, while being wrong the other way silently stops a care
service over a fault we had merely never seen before.

### Keep the knowledge where both services can read it

Telephony and the voice gateway are separate Cloud Run services, each scaling to several instances.
A fault one instance saw is useless to the instance that dials next unless it is written down. The
breaker is one Firestore document, `service/gateway`, and the read that decides whether a phone may
ring is in the same transaction as the write that claims the trial call — the same reason
`reserve()` is shaped that way. A check that is not in the transaction it guards is a race, not a
breaker.

Only the gateway writes the verdict, because only the gateway sees what Vertex AI said. Only
telephony reads it to decide, because only telephony makes a phone ring.

### Stop the routine thing, never the urgent thing

Placed next to the spend ceiling, and making the same promise. `placeCall` returns
`skipped / gateway_unavailable` and records it on the attempt, exactly as `budget_exhausted` does.
R1 detection, the SMS, email, push and voice alerts to family and staff, and the three-way
conference bridge are not gated on anything: what is broken is the conversation, and telling
somebody their mother has collapsed does not need one.

### One ring per outage, not twenty-seven

- A systemic close ends the call instead of opening two more Live sessions.
- `afterStream` does not reopen the media stream, and does not schedule the day's retry.
- Subsequent residents are not dialed at all.
- Every fifteen minutes (`GATEWAY_COOLDOWN_SEC`) exactly one call is admitted as a probe. One call
  that holds a conversation clears the breaker outright rather than counting back down, because a
  call that worked is proof the fault is over.

### Why not a preflight health check

Considered and rejected. `/health` on the gateway returns `ok` — it did throughout the outage. The
container was fine; Vertex AI was refusing it. A preflight that actually proved the conversation
could happen would have to open a real Gemini Live session, which costs money, adds latency to
every dial, and is the exact operation that is failing. The only honest preflight is a real call,
so the probe *is* a real call: the resident whose check-in is due anyway.

### The first resident still gets one ring, and that is accepted

Nothing can know the gateway is broken before something breaks on it. With the breaker, an outage
costs one ringing call — the one that discovers it — plus one every fifteen minutes while it lasts.
That resident still hears an apology, so the wording changed: the old text promised a call back in
a few minutes and then delivered one, three times, into a fault nothing was going to fix in a few
minutes. It now says the system is not working and that their care team can see they were not
reached, which is true because of the change below.

### Make the absence visible

Everything else on the staff screens is built from what a call found, so a resident nobody spoke to
produces no detections, no case, and no row. The queue now carries them directly, separated by
whether the fault is ours or the resident did not pick up — the second is the only one that says
anything about them, and is also the only one that might be the thing the daily call was for.

Wording lives in `packages/core/src/reach.ts` and is localized ja/en server-side, following the
pattern commit 12c7009 established for urgency meanings and case states. The app receives
sentences, not vocabulary it would have to translate and then let drift.

## What was verified, and what was not

| | Status |
|---|---|
| The spend cap, not a region or model mismatch, caused the outage | Verified — the close reason names it, and 10-02…10-07 calls succeeded on the same config |
| `gemini-3.8-live` works in `us-central1` | Verified — a live websocket returned `setupComplete` on 2026-10-08 23:12 JST |
| The spend cap is no longer enforcing | Verified — same probe succeeded |
| Classification of the production close reason; breaker trip, cooldown, single probe, recovery | Verified — unit tests in `packages/core/test/gateway.test.ts` |
| A known-bad gateway does not dial, and records why | Verified — `services/telephony/test/calls.test.ts` |
| The emergency path is unaffected with the breaker open | Verified — tested in telephony, the bridge, and the gateway session |
| No reconnect, no retry, no false promise once the breaker is open | Verified — `services/telephony/test/bridge.test.ts` |
| Unreached residents reach the queue, localized server-side | Verified — `services/api/test/app.test.ts` |
| **The breaker stops rings during a real Vertex AI outage** | **Not verified.** Needs an actual outage, or a deliberate one |
| **The classifier covers the reasons Vertex AI really emits** | **Partly.** The 1008 spend-cap close is the verbatim production string; the quota, permission and not-found forms are from the API's documented status names, not from observed closes |
| The Firestore transaction behaves under real contention | Not verified — the memory store is single-threaded, and the emulator contract test does not race |

The second row is the weak one and worth naming plainly: an unseen systemic fault is classified
transient, which means three rings instead of one before calls stop. That is the failure mode this
was chosen to have.

## Alternatives considered

**Treat `gateway_error` as a hangup in `bridge.ts`.** One line, and it stops the reconnection storm
within a call. Rejected as the whole answer: it leaves the three daily redials untouched and leaves
the next resident to discover the same fault, which is the part the operator was objecting to.

**Reduce `MAX_STREAMS` and `MAX_CALL_ATTEMPTS`.** Fewer rings, still ringing into a known outage,
and it weakens the retries that exist for genuinely transient faults. The problem was never the
number; it was retrying without asking what broke.

**A case per unreached resident.** Would put it on the existing queue for free. Rejected: cases are
clinical findings about a person, and ours would be an operational fact about us filed in their
record. R4's trigger set is unchanged for the same reason.

**Watch Cloud Billing or the budget API directly.** Would see the real cap rather than inferring
it. Rejected: it only covers this one cause, the account running the service has no billing-account
access, and the Budget API is disabled on the project. The next outage will be a different one.

## Consequences

- An outage costs one ringing call plus one probe per cooldown, instead of three rings per resident
  per day.
- A resident nobody reached appears at the top of the triage queue, with whose fault it was.
- `Store` grows two methods, and the Firestore layout grows `service/gateway`.
- The breaker is a new thing that can be wrong. A classifier that called an ordinary fault systemic
  would stop the service; the cooldown bounds that to fifteen minutes, and the probe is what ends
  it without anybody intervening.
