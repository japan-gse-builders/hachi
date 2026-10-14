// Entirely fictional data for matched screenshots; used only in the local in-memory preview.
const at = '2026-10-09T01:00:00.000Z';
const domains = {body: 'good', food: 'concern', sleep: 'unmentioned', mood: 'unmentioned', social: 'good', activity: 'good'};
const levels = [
  ['emergency', 'Emergency', 'Act now'], ['urgent', 'Review today', 'Check today'],
  ['action', 'Review soon', 'Follow up soon'], ['watch', 'Monitor', 'Keep an eye on changes'],
];
const people = [
  ['Margaret Ellis', 'urgent', 'Very little to eat for two days.', 'Two days of poor meals. Lives alone.'],
  ['Arthur Nakamura', 'action', 'Taking longer to answer than usual.', 'A change from his own usual pattern.'],
  ['Dorothy Ishii', 'watch', 'Ate only a small breakfast.', 'One day of poor meals; ask again tomorrow.'],
  ['Harold Brooks', 'watch', 'More hesitations than usual.', 'A small change across recent conversations.'],
];
const summary = {health: 'Said she feels well today.', meals: 'Only a little toast and tea.', topics: ['Her balcony garden', 'A call from her daughter']};
const transcript = [
  {speaker: 'agent', text: 'Have you had something to eat today?', startMs: 20000, endMs: 23500},
  {speaker: 'resident', text: 'Just a little toast again, dear. I have not had much appetite these last two days.', startMs: 25000, endMs: 32000},
  {speaker: 'agent', text: 'Thank you for telling me. Has your daughter been in touch?', startMs: 33000, endMs: 38000},
  {speaker: 'resident', text: 'Yes, she rang yesterday. It was lovely to hear her news.', startMs: 39000, endMs: 43500},
];
const notifications = [{recipient: 'staff', channel: 'email', sentAt: at, address: 'staff@example.invalid', delivery: undefined}];
const foodTag = {id: 'food.low_appetite', label: 'Little appetite', domain: 'food', polarity: 'concern'};
const socialTag = {id: 'social.contact', label: 'In touch with family', domain: 'social', polarity: 'positive'};
const days = Array.from({length: 14}, (_, i) => ({
  date: new Date(Date.parse('2026-09-26T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
  tagged: i !== 5,
  domains: i === 5 ? null : {...domains, food: i >= 12 ? 'concern' : 'good', social: i % 3 === 0 ? 'unmentioned' : 'good'},
}));

export const fixtures = {
  queue: {
    items: people.map(([residentName, urgency, text, reason], i) => ({
      caseId: 'case-' + (i + 1), residentId: 'res-' + (i + 1), residentName, urgency,
      urgencyLabel: levels.find(l => l[0] === urgency)[1], urgencyMeaning: levels.find(l => l[0] === urgency)[2],
      rule: i === 1 || i === 3 ? 'R3' : 'R2', summary: text, reason, score: 30 - i,
      detectedAt: at, status: 'open', statusLabel: 'Not started', notifications: i === 0 ? notifications : [],
    })),
    legend: levels.map(([urgency, label, action]) => ({urgency, label, action})),
    unreached: {items: [], note: null},
  },
  spend: {month: '2026-10', paused: false, usedPercent: 15, cap: '$70.00', committed: '$10.50', inFlight: '$0.00', remaining: '$59.50', note: 'AI calls have used 15% of this month’s budget.'},
  detail: {
    case: {id: 'case-1', rule: 'R2', ruleName: 'Food and drink', urgency: 'urgent', urgencyLabel: 'Review today', urgencyMeaning: 'Check on this resident today.',
      autoUrgency: 'urgent', staffUrgency: null, staffScoreOffset: 0, status: 'open', statusLabel: 'Not started',
      reason: 'Very little to eat for two days. Lives alone and has no close supporter nearby.', score: 30,
      firstDetectedAt: at, updatedAt: at, notifications, outcome: null},
    resident: {id: 'res-1', name: 'Margaret Ellis', preferredName: 'Margaret', phone: '+819000000001', householdNotes: 'Lives alone. Daughter Sarah phones from overseas on weekends.', synthetic: true,
      vulnerability: {livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: []}},
    detections: [{summary: 'Very little to eat for two days.', detectedAt: at, evidence: [{callId: 'call-1', quote: transcript[1].text, startMs: 25000, endMs: 32000, audioUrl: null}]}],
    calls: [{id: 'call-1', startedAt: at, status: 'completed', durationSec: 240, summary, transcript},
      {id: 'call-2', startedAt: '2026-10-08T01:00:00.000Z', status: 'completed', durationSec: 220, summary, transcript: []}],
    speechTrend: [], speechBaseline: null,
    screening: {
      asOf: at, domains: [{domain: 'nutrition', label: 'Meals and nutrition', answered: 1, of: 2, flagged: 1, missing: [12], meets: null}],
      overall: {answered: 5, of: 25, flagged: 1, meets: null},
      instruments: [{instrument: 'ucla3', score: 4, answered: 3, of: 3, positive: false}],
      loneliness: {status: 'incomplete', summary: 'Some questions still need answers.'}, shareMood: false,
    },
    events: [{at, actorUid: 'demo-staff', type: 'status_changed', from: 'open', to: 'in_progress', reason: 'Staff are following up.'}],
    statusOptions: [{value: 'open', label: 'Not started'}, {value: 'in_progress', label: 'In progress'}, {value: 'closed', label: 'Done'}],
    urgencyOptions: levels.map(([value, label, meaning]) => ({value, label, meaning})),
  },
  family: {
    resident: {id: 'res-1', name: 'Margaret Ellis'}, nextCallAt: '2026-10-10T01:00:00.000Z',
    glance: {latest: {startedAt: at, headline: 'Enjoyed hearing from her daughter; still has little appetite.', domains}, days,
      trends: [{...foodTag, last: 2, previous: 0, lastCalls: 7, previousCalls: 7, direction: 'more'},
        {...socialTag, last: 5, previous: 4, lastCalls: 7, previousCalls: 7, direction: 'same'}]},
    calls: [{startedAt: at, connected: true, durationSec: 240, summary, tags: [foodTag, socialTag]}],
    alerts: [{sentAt: at, channels: ['email'], caseStatus: 'in_progress', caseStatusLabel: 'Care team following up'}],
    staff: {name: 'Aiko Tanaka', phone: '+81300000000', email: 'staff@example.invalid'},
  },
  residents: [{id: 'res-1', name: 'Margaret Ellis', preferredName: 'Margaret', phone: '+819000000001', callTime: '10:00', timeZone: 'Asia/Tokyo', active: true}],
};
