# 0003. Price the ledger at Vertex list price, not at the invoice

- Status: accepted
- Date: 2026-10-08
- Related: issue #20, issue #19, ADR 0002, `docs/COST_CONTROL.md`

## Context

ADR 0002 stopped the phone ringing into a Vertex AI outage. It did not ask why the outage happened,
and the answer turns out to be that the two ceilings meant to protect each other were in the wrong
order — and that nothing in the repository could have noticed.

Three figures existed for October's Vertex AI spend and they disagreed by a factor of 2.7:

| Source | October |
|---|---|
| Cloud Monitoring token counts, priced with the repo's own configured prices | ≈¥1,500 |
| Free Trial credit actually consumed, all services | ≈¥3,257 |
| What the Spend Cap counted (gross, list price, pre-credit), Vertex AI only | ¥4,032 |

The configured prices were `$0.03`/Live-minute, `$0.5`/M input and `$3`/M output. Vertex AI's list
prices for the models actually called are:

| Model | Item | List / 1M tokens |
|---|---|---|
| `gemini-3.8-flash` (global) | input (text, image, video, audio) | **$1.50** |
| | text output (response and reasoning) | **$7.50** |
| `gemini-3.8-live` (non-global) | audio input | **$3.00** |
| | audio output | **$12.00** |

Pricing both the measured token counts three ways accounts for all three figures:

| Prices used | Flash | Live | Total | JPY @150 |
|---|---|---|---|---|
| as configured ($0.5/$3) | $9.60 | $0.14 | $9.74 | ¥1,460 |
| Vertex invoice ($0.75/$3.75) | $12.57 | $0.73 | $13.29 | ¥1,994 |
| Vertex list ($1.50/$7.50) | $25.14 | $0.73 | $25.86 | ¥3,879 |

$25.86 / $9.74 = **2.66**. The reported 2.7x was real, and it was not one mistake but two sitting on
top of each other:

1. The configured token prices were Gemini 2.5-era numbers: a third of Flash 3.8's list input and
   two fifths of its list output.
2. Flash 3.8's `$0.75 / $3.75` introductory rate is **granted as a 50% credit against a $1.50 /
   $7.50 list**, and a spend cap budget is forced to `creditTypesTreatment: EXCLUDE_ALL_CREDITS` and
   enforces on gross estimated cost at list. So even pricing the ledger at what we pay would have
   left it counting at half the rate the thing that stops the API counts at.

`docs/COST_CONTROL.md` claimed the accounting was deliberately conservative (「計上は保守的に倒して
ある」). For the token prices that was simply false.

The Live per-minute figure is the more interesting case. Audio is 25 tokens a second, so a minute in
both directions at list is $0.0225 and `$0.03` did bound it — on the model the code was using. That
model is wrong: Vertex bills Live by the token and **re-bills the entire session context on every
turn**, so prior audio is charged again as input on each later turn and a call's cost grows with the
square of its length. October's Live traffic shows an input:output token ratio of 9.8 (171,765 /
17,475), which for a roughly symmetric conversation implies about nine re-billings per call on calls
averaging 35 seconds of model speech.

## Decision

### Price at list, because list is what can stop us

The ledger's only job that nothing else does is to fire before Google's spend cap. That cap is
measured in gross list prices, so the ledger is too. Pricing at the invoice would put our ceiling
below Google's in our own arithmetic and above it in Google's, which is the one arrangement that
cannot work — and it fails by cutting off a call that is already ringing.

This has a convenient property: `$1.50 / $7.50` is both what a spend cap counts today and what the
invoice itself says from 2027-01-01, when the introductory cohort reverts. One number, no expiry
date to miss.

### Keep the per-minute Live model, and make the figure a bound

The honest model is per-token, and the gateway could report real `usageMetadata` from the Live
session. Rejected for now, because `callReservationMicros()` has to answer **before the phone
rings** and the only thing known then is `MAX_CONVERSATION_SEC`. A per-minute figure is what makes
pre-dial reservation possible at all, and reserving the worst case is what stops a month going over
because several calls happened to run long at once.

So the model stays and the number becomes an upper bound rather than an average:

```
1,500 tokens/min × ($12 audio out + $3 audio in × ~16 re-billings) / 1M ≈ $0.09/min
```

at the default 480 s cap and the ~15 s turns October showed. The default is **$0.15/min**, which
adds room for shorter turns and for `MAX_CONVERSATION_SEC` being raised to the 900 s the gateway
permits.

Because cost grows with the square of duration, a per-minute rate calibrated at the cap
over-estimates every call shorter than the cap. A real 35-second call settles at about $0.09 against
roughly $0.04 of actual gross. That is a 2x over-count in the only direction a ceiling survives
being wrong in, and it costs availability rather than money: settlement replaces the reservation
with the actual duration, so over-reserving limits concurrency, not the month's total.

### $70, not $100

¥15,000 of Google spend cap is $100 at 150 JPY/USD. Stopping at `0.9 × $70 = $63` leaves ¥5,550 —
37% of the cap — and puts Google's ceiling at 1.59x ours. At 180 JPY/USD the cap is $83.3 and $63 is
still 24% below it.

The margin is not slack. A JPY cap guarded by a USD ledger makes the exchange rate an input we do
not control, and Google's own USD-to-JPY conversion is not a rate we specified. `AI_SPEND_STOP_
FRACTION`'s 10% is a different allowance, for calls in flight being estimates; it is not available
for this.

### Record eval spend; refuse an eval only once calls have already stopped

Two eval scripts caused roughly 94% of October's Gemini spend — about $9.72 across 10/04 and 10/05
against $0.1–0.3 on an ordinary day — and none of it reached the ledger: `eval/run.ts` never passed
`onUsage`, and `eval/r12-run.ts` charged a `MemoryStore` it then dropped. All three scripts now write
to Firestore. A run that measures its own cost into a store it throws away has told nobody.

Refusal is deliberately weaker than the daily call's. The asymmetry is the justification: a
scheduler dialing hundreds of residents cannot read a number and decide, so it has to fail closed;
an eval is run by a person at a terminal who can. Submission is 2026-10-18, a run costs ¥500–1,000,
and several are needed, so a wall in front of the last rehearsal before a deadline is the more
expensive mistake.

The run therefore prints the month unconditionally, refuses only when the month is **already past
the stop** — "close" does not refuse, because the last tenth is the margin and an eval is the one
operation large enough to spend all of it at once — and goes ahead on `--ignore-budget`, still
recording. An unreadable ledger refuses on the same flag, since continuing would be the original
blindness with code in place claiming to have fixed it.

### Charge the listener too

`GeminiListener.listen()` reported no usage at all, so the SPK-01/SPK-03 speech measurement — a
second Gemini request carrying a minute of audio as its prompt — was invisible to the ledger in
normal production, not only in evals. It now reports usage the same way the reviewer does.

## What was verified, and what was not

| | Status |
|---|---|
| Vertex list prices for `gemini-3.8-flash` and `gemini-3.8-live` | Verified — Agent Platform generative AI pricing page, 2026-10-08, both the Gemini 3 table and the Live API table |
| Flash's $0.75/$3.75 is a credit against $1.50/$7.50, not a separate rate | Verified — the page's own footnote: "Promotional pricing provided through 50% credits back on net spend" |
| Live re-bills the whole session context every turn | Verified — "Live API Billing Details" on the same page, and the Gemini API forum answer from Google |
| Audio is 25 tokens per second | Verified — stated as the conversion metric on the pricing page |
| Live runs non-global (`us-central1`), Flash runs `global` | Verified — `services/voice-gateway/src/config.ts`, `services/analyzer/eval/*` |
| The three figures reconcile to within 3.8% | Verified — arithmetic in `docs/COST_CONTROL.md` §2, from the operator's own token counts |
| New prices, cap, and the ordering | Verified — `packages/core/test/spend.test.ts` |
| Eval refusal, recording, and surviving a failed ledger write | Verified — `services/analyzer/test/eval-spend.test.ts` |
| The emergency path is unaffected | Verified — unchanged; no ceiling was added to it, and R4's trigger set is untouched |
| **The ¥4,032 figure itself** | **Not verified against the API.** It is what the console showed at enforcement; the 3.8% gap to our ¥3,879 is explained by inference, not measurement |
| **The ~16 re-billings behind $0.15/min** | **Inferred.** Back-calculated from October's 9.8:1 Live input:output ratio, not from decomposing a single call's turns |
| **That the new ordering holds in production** | **Not verified.** ¥5,550 of headroom is arithmetic; nobody has watched $63 arrive before ¥15,000 |
| The exchange rate | Assumed at 150 JPY/USD. Google's own USD→JPY conversion is not a rate we set |

The second and third rows are the weak ones. If turns are shorter than 15 seconds the re-billing
factor is larger and `$0.15/min` could still under-state a maximum-length call; the ¥5,550 of cap
headroom is what absorbs that, and the gateway breaker from ADR 0002 is what keeps the consequence
from being a ringing phone if it does not.

## Alternatives considered

**Price at the invoice ($0.75/$3.75) and raise `AI_MONTHLY_CAP_USD` to compensate.** Arithmetically
equivalent today and wrong as soon as anybody reads it: the staff spend view would show a number
that looks like money we owe, against a cap that is not in those units. Two of the three figures in
§2 of `COST_CONTROL.md` disagreed for exactly this kind of reason.

**Bill Live from the session's real `usageMetadata`.** The correct model, and still wanted. Rejected
as the whole answer because it cannot be known before dialing, which is when the reservation has to
be taken. The right shape is probably both: reserve on the per-minute bound, settle on reported
tokens. Settling on actuals needs the gateway to report usage back to telephony across a service
boundary, which is more than this change should carry.

**Refuse every eval run above the stop fraction, with no override.** Consistent with the daily call
and the reason it was rejected is in the Decision: ten days before submission, a ceiling that blocks
demo preparation has chosen the cheaper failure over the more expensive one.

**Lower `AI_SPEND_STOP_FRACTION` instead of lowering the cap.** Moves the same line while making the
cap a number that means nothing — staff would see "70% of $200" and a service that had already
stopped. The cap is what people reason with, so the cap is what changed.

**Read the Spend Cap through the Billing Budgets API so the ledger knows the real figure.** Rejected
for the reasons ADR 0002 already gave: the service account has no billing-account access and the
Budget API is disabled on the project. It would also only ever cover this one cause.

## Consequences

- A month's ledger total is now roughly 2.7x its old value for identical traffic. The number is not
  what the invoice will say, by design, and `COST_CONTROL.md` §2 is where that is written down.
- Reservations per call rise from about $0.25 to about $1.31, so fewer calls can be in flight at
  once under a small cap. Settlement still replaces the reservation with the actual duration.
- Eval runs consume the same budget the residents' calls do, and show it. With $63 of room and runs
  costing ¥500–1,000, the operator can see how many remain before the deadline instead of finding
  out from a websocket close.
- `$0.15/min` is a bound, not a price. If Live's billing model or the turn rate changes, it is wrong
  in a direction that stops calls early rather than late — and `GEMINI_LIVE_PRICE_PER_MIN` is an
  environment variable precisely so that correcting it does not need a release.
