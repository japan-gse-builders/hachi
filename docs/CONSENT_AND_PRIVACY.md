# Consent and privacy

This document describes how Hachi is meant to be used with consent and what personal data it handles.
Each point is marked:

- **[Code]** enforced by the software in this repository.
- **[Operational]** must be done by the care organisation running Hachi; the software does not check it.

> **Not legal advice.** This is a design description, not a legal opinion. Any organisation deploying
> Hachi must confirm its own obligations under the Act on the Protection of Personal Information
> (APPI) and any other applicable rules with qualified advisers.

## 1. Approval before the first call

- **[Code]** `/privacy` is public, needs no sign-in or Firebase configuration, and includes support
  instructions. The footer links to it from both staff and family screens. The page, the staff
  enrollment notice and the unauthenticated API endpoint `GET /privacy-notice` use shared text in
  `packages/core/src/privacy.ts`, including the short first-use explanation. The version identifies
  the information shown; it does not expire an existing approval when the text changes.
- **[Operational]** Residents use a telephone, so staff read the **short first-use explanation**, answer
  questions, and ask for explicit approval. A reply such as **“Yes, I agree.”** is sufficient; the resident
  does not need to recite a script or read the full page aloud. The full notice remains available on
  `/privacy` and in an expandable section of the form for questions and further explanation.
  The notice explains Google Gemini processing, recordings and
  analysis, what staff and family can see, emergency alerts, locations, retention and stopping.
  The software records staff's attestation; it cannot verify that this conversation took place.
- **[Code]** Staff can record approval while adding a resident, or later on the Residents screen.
  The API accepts only an affirmative answer for the notice currently shown, and records the staff
  user ID and time on the server in `resident.callConsent`. Saving details without approval is
  allowed. It does **not** permit calls. Existing residents without this record are also pending;
  staff must obtain and record their approval before daily calls resume after this update.
  A newly saved pending enrollment starts its baseline and screening rotation when approval is
  recorded, so waiting does not consume its first four weeks. Existing residents and explicitly
  dated historical imports retain their service start.
- **[Code]** Pending residents are excluded from scheduling and missed-check-in warnings. The
  telephony worker checks again before dialing, including previously queued tasks and retries.
  The Voice Gateway refuses to start an AI session or recording without approval. Family screens
  do not advertise a next call while approval is pending. Normal daily calls reuse the saved
  first-use approval; there is no repeated approval prompt or automatic re-consent on version changes.
- **[Code]** New first-use approvals include short family updates about mood and loneliness,
  explained in the short prompt and full notice. The API records this sharing approval in
  `resident.consent` with the same staff identity and time; there is no separate sharing checkbox.
  Pending enrollment does not imply sharing approval. Existing sharing choices are preserved,
  including opt-outs, and resubmitting an old call approval does not expand its scope. Staff can
  still record a later sharing request through `shareMood` in the API without altering call approval.
- **[Operational]** The family member agrees to receive alerts and access the dashboard, and the
  resident agrees to the chosen family contact (requirements §4). There is no separate family
  approval record in Hachi.
- **[Code]** Staff can use **Pause calls** on the Residents screen, which sets `active: false`.
  This stops future daily calls, queued attempts and stream reconnections. It does not interrupt an
  AI conversation already running. The resident can hang up to end that conversation. Emergency
  bridges and alert calls for an emergency already raised remain available.
- **[Operational]** Stopping future calls is a request to the enrolling care team. There is no
  automatic spoken withdrawal detector in the call. Deletion and retention are separate processes.
  Removing a family contact (`family: null` on `PATCH /api/residents/:id`) stops their dashboard
  access on the next request; this action is available in the API, not the staff UI.

The public page directs people to their enrolling care team and the contacts shown on the family
dashboard; this repository has no organisation-wide support email or telephone number configured.
Historical call imports and synthetic evaluations remain staff-only/offline workflows. The new
approval gate protects live calls; staff remain responsible for obtaining permission for imported
historical data.

## 2. What Hachi tells the resident on every call

- **[Code]** The Voice Gateway's system instruction tells Gemini to open every call by greeting the
  resident and saying that this is Hachi, an AI assistant calling for the daily check-in, and that the
  call is recorded so the care team can help (`services/voice-gateway/src/prompt.ts`). Because this
  is spoken by the model, the exact words can vary and delivery is not verified on each call; the
  instruction itself is fixed and covered by a test.
- **[Code]** When no Voice Gateway is configured, the telephony service plays a fixed message that
  says "This is Hachi, an AI assistant" (`buildCallTwiml` in `services/telephony/src/twilio.ts`).
- **[Code]** If someone else answers, Hachi asks for the resident and otherwise ends the call. On
  voicemail it leaves no message.
- **[Code]** In an emergency Hachi tells the resident that it is contacting family and staff and that
  they should call 119 if they can. Family and staff are phoned without asking the resident first;
  this was a deliberate safety decision and must be part of what residents agree to.

## 3. Who can see what

| Data | Care staff | Family | Enforced by |
|---|---|---|---|
| Call recordings | Yes, on the case page (signed URL valid 15 minutes) | **No** | [Code] API |
| Transcripts and quoted evidence | Yes | **No** | [Code] API |
| Speech analysis (R3 features, baseline, trend) | Yes | **No** | [Code] API |
| Short plain-language summary per call | Yes | With mood-sharing approval (last 14 days) | [Code] API |
| Mood status and loneliness updates | Yes | With mood-sharing approval | [Code] API / analyzer |
| Call times, connected or not, duration | Yes | Yes (last 14 days) | [Code] API |
| Alerts sent to the family member and case status | Yes | Yes | [Code] API |
| Staff name and contact | Yes | Yes | [Code] API |

- **[Code]** Browsers never read Firestore or Cloud Storage directly: Firestore rules deny all client
  access and the recordings bucket is private. All access goes through the API, which verifies a
  Firebase ID token on every request.
- **[Code]** Staff are members of an organization, checked on every request from a membership record
  (ADR 0004): a verified email is required, a member whose access is turned off or who signed out
  everywhere is refused at once, and residents, cases and held messages of another organization get
  the same response as missing ones. Changes to members, settings, residents and cases are written to
  the organization's activity log, which only its admins can read. Family members sign in with an
  email link; they see only residents whose registered family contact matches their verified email
  or phone. Unknown and "not yours" residents get the same response.
- **[Code]** Family messages never include transcript quotes. SMS contains no link, phone number or
  quote.
- **[Code]** Without mood-sharing approval, the family API withholds mood states, generated
  headlines and free-text summaries, which can contain emotional information. The family view
  hides the Mood area. Family-visible tags, call times, alerts and neutral emergency follow-up
  messages remain available; transcripts and speech analysis remain staff-only in all cases.
- **[Operational]** Deciding who is given a staff account, and removing it when they leave.

## 4. Data minimisation

- **[Code]** Hachi stores what the requirements need: name, preferred name, phone number, call time,
  the information used for prioritisation (household situation, close supporter, care needs, chronic
  conditions), staff and family contacts, calls (recording, transcript, summaries, speech features),
  short memories for the next conversation, and cases.
- **[Code]** Logs carry resident, call and outbox IDs, not transcripts or contact addresses.
  Notification idempotency keys contain a hash of the address, not the address.
- **[Code]** Synthetic evaluation and demo residents are stored with `synthetic: true`, have
  made-up names and no contact details, and are never called.
- **[Operational]** Entering only what is needed in the free-text household notes.

## 5. Retention — [Operational]

Hachi does **not** delete data automatically yet: there is no Firestore TTL policy and no Cloud
Storage lifecycle rule in this repository. The organisation must decide and apply retention periods,
for example:

- recordings: a short period (such as 90 days), set as a lifecycle rule on the recordings bucket;
- transcripts and speech features: as long as needed for the 28-day baseline and recent trend;
- cases and staff decisions: as required for care records and for evaluating the rules (PRI-06);
- everything about a resident: deleted when they leave the service, unless a record must be kept.

Two things already expire in code: signed recording URLs (15 minutes) and family sign-in links.

## 6. Where data is processed

- **[Code]** Firestore, the recordings bucket and most services are in `asia-northeast1` (Tokyo) by
  default.
- **[Code]** The Voice Gateway runs in `us-central1` because the Gemini Live API is served there, so
  live call audio is processed in the United States. Post-call analysis calls Gemini with location
  `global` by default.
- **[Code]** Calls and SMS go through Twilio (United States); email, if enabled, through SendGrid.
- **[Code]** Twilio, SendGrid and other credentials are kept in Secret Manager and injected into Cloud
  Run; none are stored in the repository.

## 7. APPI points to check (not legal advice)

- **Sensitive personal information.** Health information (symptoms, eating, signs of cognitive
  change) is likely "special care-required personal information" (要配慮個人情報), which generally
  needs the person's prior consent to collect.
- **Purpose of use.** Tell residents and family the purposes: daily check-in, spotting changes for
  care staff, emergency alerts, and improving the detection rules.
- **Third parties and overseas transfer.** Sharing with family, and processing by Google Cloud,
  Twilio and SendGrid (some in the United States), may count as provision to third parties or
  transfer to a foreign country. Check whether consent or equivalent safeguards and information about
  the destination country's regime are needed.
- **Security measures.** Access control, encryption in transit and at rest (Google Cloud default),
  least-privilege service accounts, and staff training.
- **Requests from individuals.** Have a process for disclosure, correction and deletion requests;
  Hachi has no self-service feature for this.
- **Capacity.** Where a resident's ability to consent is in doubt, follow the organisation's policy
  and any guardian arrangements.
