// Entirely fictional people for recording the demo video in the local preview (USR-04).
// Loaded by scripts/local-preview.mjs when PREVIEW_FIXTURE points here; adds Edith Carter (a change
// in speech, R3) and Walter Hughes (chest pain now, R1) to Sakura Home Care. Nothing here is sent anywhere.
import { domainStates, localDate, PRIVACY_NOTICE } from '../../../packages/core/dist/index.js';

const DAY = 86_400_000;
const zone = 'Asia/Tokyo';
const orgId = 'demo-company-sakura';

/** Deterministic noise, so every recording shows the same chart. */
function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

function resident(data, now, fields) {
  const owner = data.memberships.find((m) => m.orgId === orgId && m.role === 'owner');
  const joined = new Date(now.getTime() - 41 * DAY).toISOString();
  return {
    orgId, phone: '', channel: 'pstn', timeZone: zone, synthetic: true, active: true,
    owner: { uid: owner.uid, name: owner.name, email: owner.email, since: joined },
    staff: { uid: owner.uid, name: owner.name, phone: '', email: owner.email },
    familyLookup: [], familyAccess: [],
    callConsent: { accepted: true, noticeVersion: PRIVACY_NOTICE.version, recordedAt: joined, recordedBy: 'demo-video' },
    consent: { shareMood: true, recordedAt: joined, recordedBy: 'demo-video' },
    serviceStartedAt: joined, createdAt: joined, updatedAt: now.toISOString(),
    ...fields,
  };
}

function call(r, id, startedAt, transcript, tagIds, summary, headline, speech) {
  const tags = tagIds.map(([tag, turn]) => ({ id: tag, turn, basis: 'said', confidence: 0.92 }));
  const endedAt = new Date(Date.parse(startedAt) + 260_000).toISOString();
  const date = localDate(new Date(startedAt), zone);
  return {
    id, residentId: r.id, source: 'imported', synthetic: true, status: 'completed', channel: 'pstn',
    startedAt, endedAt, durationSec: 260, createdAt: startedAt, localDate: date, analysisPending: false,
    summary, familySummary: summary, transcript,
    wellbeing: { tags, domains: domainStates(tagIds.map(([t]) => t)), headline },
    analysis: { at: endedAt, turns: transcript.length, intake: { date, status: 'normal' }, memory: { topics: summary.topics, plans: [], likes: [] } },
    ...(speech ? { speech: { callId: id, at: startedAt, usable: true, exclusionReasons: [], measuredFrom: 'audio', features: speech } } : {}),
  };
}

const turn = (speaker, text, startMs, endMs) => ({ speaker, text, startMs, endMs });

const EDITH_DAYS = [
  { tags: [['sleep.slept_well', 1], ['food.ate_well', 3], ['activity.walk', 5], ['social.family_contact', 7]], headline: 'Slept well and enjoyed a walk to the shops.', topics: ['A walk to the shops', 'A call from Michael'] },
  { tags: [['body.feeling_well', 1], ['food.cooked', 3], ['activity.gardening', 5], ['mood.cheerful', 7]], headline: 'In good spirits after an afternoon with her balcony plants.', topics: ['Her balcony herbs', 'Cooking soup'] },
  { tags: [['sleep.slept_well', 1], ['food.ate_well', 3], ['social.saw_friends', 5], ['mood.looking_forward', 7]], headline: 'Had tea with her neighbour and is looking forward to the weekend.', topics: ['Tea with Mrs Yamada', 'Weekend plans'] },
];

function addEdith(data, now) {
  const r = resident(data, now, {
    id: 'demo-edith', name: 'Edith Carter', preferredName: 'Edith', portrait: 'grandmother-3', callTime: '09:30',
    vulnerability: { livesAlone: true, hasCloseSupporter: true, needsCare: false, chronicConditions: [] },
    householdNotes: 'Son Michael phones from overseas on Sundays.',
    family: { name: 'Michael Carter', relationship: 'Son', email: 'family@example.invalid' },
    familyLookup: ['family@example.invalid'],
  });
  data.residents.push(r);

  // 28 days of usual speech (every other day), then daily calls; the last five drift slower, with more restarts.
  const latest = now.getTime() - 3 * 3600_000;
  const start = Date.parse(r.serviceStartedAt);
  const days = [];
  for (let d = 0; d < 28; d += 2) days.push(start + d * DAY + 2 * 3600_000);
  for (let at = latest - 13 * DAY; at <= latest; at += DAY) days.push(at);
  const rnd = noise(7);
  const calls = days.map((t, i) => {
    const fromEnd = days.length - 1 - i;
    const drift = fromEnd < 5 ? (5 - fromEnd) / 5 : 0;
    const speech = {
      responseLatencyMs: Math.round(1130 + rnd() * 160 + drift * 1150),
      repairRate: +(1.0 + rnd() * 0.5 + drift * 2.2).toFixed(2),
      lexicalDiversity: +(0.81 + rnd() * 0.02).toFixed(3),
      topicCoherence: +(0.95 + rnd() * 0.04).toFixed(2),
    };
    const day = EDITH_DAYS[i % EDITH_DAYS.length];
    const startedAt = new Date(t).toISOString();
    const isLatest = fromEnd === 0;
    const transcript = isLatest
      ? [
          turn('agent', 'Good morning Edith, this is Hachi calling for our daily chat. How did you sleep last night?', 0, 6000),
          turn('resident', 'Oh, not too badly, thank you. I slept right through the night for once.', 8600, 13500),
          turn('agent', 'That is good to hear. Have you had something to eat today?', 14500, 18000),
          turn('resident', 'Yes, toast with jam, the same as most mornings, and a cup of tea.', 20600, 25500),
          turn('agent', 'What did you get up to yesterday?', 70000, 72500),
          turn('resident', 'I went to get bread from the from the bakery near the station. The one with the, the blue door.', 75000, 82000),
          turn('agent', 'Oh, how lovely. Has Michael been in touch?', 83000, 86000),
          turn('resident', 'Yes, he rang on Sunday. My grandson Jack has started at a new school.', 88500, 94000),
        ]
      : [
          turn('agent', 'Good morning Edith, this is Hachi calling for our daily chat. How are you feeling today?', 0, 6000),
          turn('resident', 'I am feeling quite well today, thank you for asking.', 7200, 10500),
          turn('agent', 'What have you had to eat today?', 11500, 13500),
          turn('resident', 'Toast with jam for breakfast, and I will make soup for lunch.', 14700, 18500),
          turn('agent', 'What did you get up to yesterday?', 19500, 21500),
          turn('resident', 'I walked down to the shops and back, and watered my herbs on the balcony.', 22700, 27500),
          turn('agent', 'That sounds nice. Has anyone been in touch?', 28500, 31000),
          turn('resident', 'Michael rang on Sunday, as he always does.', 32200, 35000),
        ];
    const tags = isLatest ? [['sleep.slept_well', 1], ['food.ate_well', 3], ['activity.went_out', 5], ['social.family_contact', 7]] : day.tags;
    const headline = isLatest ? 'Slept well, walked to the bakery, and heard from Michael on Sunday.' : day.headline;
    const topics = isLatest ? ['The bakery near the station', 'Jack’s new school'] : day.topics;
    return call(r, `edith-call-${i + 1}`, startedAt, transcript, tags,
      { health: 'Said she slept well and feels fine.', meals: 'Toast with jam and tea.', topics }, headline, speech);
  });
  data.calls.push(...calls);

  const last = calls.at(-1);
  data.cases.push({
    id: 'demo-edith-case', orgId, residentId: r.id, rule: 'R3', autoUrgency: 'action', status: 'open',
    firstDetectedAt: last.endedAt, updatedAt: last.endedAt, notifications: [],
    detections: [{
      residentId: r.id, rule: 'R3', urgency: 'action', confidence: 0.82, detectedAt: last.endedAt,
      summary: 'Slower to answer and restarting sentences more often than usual.', changeMagnitude: 2.4, trend: 'worsening',
      evidence: [{ callId: last.id, quote: 'I went to get bread from the from the bakery near the station. The one with the, the blue door.', startMs: 75000, endMs: 82000 }],
    }],
  });
}

function addWalter(data, now) {
  const r = resident(data, now, {
    id: 'demo-walter', name: 'Walter Hughes', preferredName: 'Walter', portrait: 'grandfather-3', callTime: '11:00',
    vulnerability: { livesAlone: false, hasCloseSupporter: true, needsCare: false, chronicConditions: [] },
    householdNotes: 'Lives with his wife. Daughter Anne lives in Osaka.',
    family: { name: 'Anne Hughes', relationship: 'Daughter', email: 'anne.hughes@example.invalid' },
  });
  data.residents.push(r);
  const latest = now.getTime() - 31 * 60_000;
  const calls = [];
  for (let d = 6; d >= 0; d--) {
    const startedAt = new Date(latest - d * DAY).toISOString();
    const transcript = d === 0
      ? [
          turn('agent', 'Good morning Walter, this is Hachi calling for your daily check-in. How are you feeling today?', 0, 6000),
          turn('resident', 'Not good. I have a tight pain in my chest and it is going down my arm.', 7000, 12000),
          turn('agent', 'Thank you for telling me, Walter. I am letting your family and care staff know right now, and I will connect them in a moment.', 12500, 19000),
        ]
      : [
          turn('agent', 'Good morning Walter, this is Hachi calling for your daily check-in. How are you feeling today?', 0, 6000),
          turn('resident', 'Fine, thank you. I had a good breakfast and read the paper.', 7000, 11000),
        ];
    calls.push(call(r, `walter-call-${7 - d}`, startedAt, transcript,
      d === 0 ? [['body.pain', 1]] : [['body.feeling_well', 1], ['food.ate_well', 1]],
      d === 0 ? { health: 'Said he has chest pain right now.', meals: 'Not discussed.', topics: [] } : { health: 'Feeling fine.', meals: 'A good breakfast.', topics: ['The morning paper'] },
      d === 0 ? 'Said he has chest pain right now.' : 'A comfortable morning with a good breakfast.', null));
  }
  data.calls.push(...calls);
  const last = calls.at(-1);
  const sentAt = new Date(Date.parse(last.startedAt) + 12_000).toISOString();
  data.cases.push({
    id: 'demo-walter-case', orgId, residentId: r.id, rule: 'R1', autoUrgency: 'emergency', status: 'open',
    firstDetectedAt: sentAt, updatedAt: sentAt,
    notifications: [
      { recipient: 'staff', channel: 'email', address: 'aiko.tanaka@sakura.example.invalid', sentAt },
      { recipient: 'family', channel: 'email', address: 'anne.hughes@example.invalid', sentAt },
    ],
    detections: [{
      residentId: r.id, rule: 'R1', urgency: 'emergency', confidence: 0.97, detectedAt: sentAt, summary: 'Said he has chest pain right now.',
      evidence: [{ callId: last.id, quote: 'Not good. I have a tight pain in my chest and it is going down my arm.', startMs: 7000, endMs: 12000 }],
    }],
  });
}

/** Harold did not pick up today, twice, so the queue shows that nobody has heard from him. */
function missHarold(data, now) {
  const residentId = 'demo-sakura-patient-4';
  const today = localDate(now, zone);
  data.calls = data.calls.filter((c) => !(c.residentId === residentId && c.localDate === today));
  for (const [n, minutesAgo] of [[1, 95], [2, 65]]) {
    const startedAt = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    data.calls.push({
      id: `harold-missed-${n}`, residentId, source: 'imported', synthetic: true, status: 'no_answer', channel: 'pstn',
      startedAt, endedAt: startedAt, durationSec: 0, createdAt: startedAt, localDate: today, analysisPending: false,
    });
  }
}

/** Called with the demo dataset before it is stored. */
export function extend(data, now) {
  // One "Review soon" card in the queue, so the camera can stop on Edith's.
  data.cases = data.cases.filter((c) => c.id !== 'demo-sakura-case-2');
  addEdith(data, now);
  addWalter(data, now);
  missHarold(data, now);
}
