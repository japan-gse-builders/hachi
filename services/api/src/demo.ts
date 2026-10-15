/** Pure fictional fixtures shared by the local preview and the operator-only seed script.
 * Nothing imports this module from the production server; generating it performs no writes.
 */
import { domainStates, localDate, PRIVACY_NOTICE, zonedTimeToUtc, type CallTag, type Urgency } from '@hachi/core';
import type { CallRecord, Membership, Organization, Resident, ResidentPortrait, StoredCase } from '@hachi/store';

export const DEMO_SEED = 'hachi-companies-v1';
const DAY = 86_400_000;
const zone = 'Asia/Tokyo';
const companies = [
  { key: 'sakura', name: 'Sakura Home Care', staff: ['Aiko Tanaka', 'Kenji Mori', 'Yuki Sato', 'Emma Wilson'],
    patients: ['Margaret Ellis', 'Arthur Nakamura', 'Dorothy Ishii', 'Harold Brooks', 'Claire Watanabe'],
    times: ['08:30', '10:00', '11:15', '14:30', '17:00'] },
  { key: 'midori', name: 'Midori Community Care', staff: ['Naomi Fujita', 'Daniel Kim', 'Hana Ito', 'Ryo Matsuda'],
    patients: ['Eleanor Park', 'Robert Hughes', 'Keiko Bennett', 'George Sakamoto', 'Patricia Lewis'],
    times: ['09:00', '10:30', '12:00', '15:00', '18:00'] },
  { key: 'harbor', name: 'Harbor Care Partners', staff: ['Sophie Chen', 'Daichi Yamamoto', 'Maya Patel', 'Oliver Reed'],
    patients: ['Helen Foster', 'David Mori', 'Grace Yamashita', 'Peter Collins', 'Rose Takeda'],
    times: ['08:45', '09:45', '11:30', '16:00', '18:30'] },
] as const;

export interface DemoViewer { uid: string; email: string; name?: string }
export interface DemoData {
  organizations: Organization[]; memberships: Membership[]; residents: Resident[];
  calls: CallRecord[]; cases: StoredCase[];
}

export function buildDemoData(now: Date, viewer?: DemoViewer): DemoData {
  const result: DemoData = { organizations: [], memberships: [], residents: [], calls: [], cases: [] };
  const at = now.toISOString();
  const joined = new Date(now.getTime() - 60 * DAY).toISOString();
  const portraits: ResidentPortrait[] = ['grandmother-2', 'grandfather-1', 'grandmother-1', 'grandfather-4', 'grandmother-4'];
  const roles = ['owner', 'admin', 'member', 'member'] as const;
  for (const [companyIndex, company] of companies.entries()) {
    const orgId = `demo-company-${company.key}`;
    result.organizations.push({ id: orgId, name: company.name, timeZone: zone, status: 'active',
      // Hosted demo organizations deliberately remain unverified: no outbound contact.
      billing: { plan: 'trial', email: `billing@${company.key}.example.invalid`, limits: { residents: 20, members: 10 } },
      createdAt: joined, createdBy: DEMO_SEED, updatedAt: at });
    const members = company.staff.map((name, i): Membership => ({
      orgId, uid: `demo-${company.key}-${i + 1}`, name,
      email: `${name.toLowerCase().replaceAll(' ', '.')}@${company.key}.example.invalid`,
      role: roles[i]!, status: 'active', joinedAt: new Date(Date.parse(joined) + i * DAY).toISOString(), updatedAt: at,
    }));
    result.memberships.push(...members);
    if (viewer && !members.some((m) => m.uid === viewer.uid)) {
      result.memberships.push({ ...viewer, orgId, role: 'admin', status: 'active', joinedAt: joined, updatedAt: at });
    }
    for (const [i, name] of company.patients.entries()) {
      const id = `demo-${company.key}-patient-${i + 1}`;
      const owner = members[i % members.length]!;
      const callTime = company.times[i]!;
      const resident: Resident = {
        id, orgId, name, preferredName: name.split(' ')[0]!, portrait: portraits[i]!, phone: '',
        channel: 'pstn', callTime, timeZone: zone, synthetic: true, active: i !== 4,
        vulnerability: { livesAlone: i % 2 === 0, hasCloseSupporter: i !== 1, needsCare: i === 1, chronicConditions: [] },
        householdNotes: ['Enjoys gardening and chats with a neighbor most afternoons.', 'Prefers a call after breakfast and the morning newspaper.',
          'Visits the community center on Wednesdays.', 'Likes discussing books and weekend family visits.', 'Daily calls are paused while staying with family.'][i]!,
        owner: { uid: owner.uid, name: owner.name!, email: owner.email, since: joined },
        staff: { uid: owner.uid, name: owner.name!, phone: '', email: owner.email },
        familyLookup: [], familyAccess: [],
        callConsent: { accepted: true, noticeVersion: PRIVACY_NOTICE.version, recordedAt: joined, recordedBy: DEMO_SEED },
        consent: { shareMood: true, recordedAt: joined, recordedBy: DEMO_SEED },
        serviceStartedAt: joined, createdAt: joined, updatedAt: at,
      };
      result.residents.push(resident);
      const todayCall = zonedTimeToUtc(localDate(now, zone), callTime, zone);
      // Only completed past calls. History follows each patient's schedule, even before today's slot.
      const latest = new Date(todayCall.getTime() + 240_000 <= now.getTime() ? todayCall.getTime() : todayCall.getTime() - DAY);
      const concern = i < 3;
      for (let day = 0; day < 7; day++) {
        const startedAt = new Date(latest.getTime() - day * DAY).toISOString();
        const endedAt = new Date(Date.parse(startedAt) + 240_000).toISOString();
        const poorFood = (i === 0 && day < 2) || (i === 2 && day === 0);
        const mealReply = i === 2 && day === 0 ? 'I only had a small breakfast today.'
          : poorFood ? 'I have had very little to eat for two days.' : 'I enjoyed breakfast and I am looking forward to lunch.';
        const tags: CallTag[] = [
          { id: poorFood ? 'food.ate_little' : 'food.ate_well', turn: 1, basis: 'said', confidence: 0.95 },
          { id: 'social.family_contact', turn: 3, basis: 'said', confidence: 0.9 },
        ];
        const summary = { health: 'Feeling comfortable at home.', meals: i === 2 && day === 0 ? 'Only a small breakfast today.' : poorFood ? 'Little appetite over the last two days.' : 'Enjoyed breakfast and plans to cook lunch.',
          topics: [i % 2 === 0 ? 'Balcony garden' : 'A favorite book', 'A recent family visit'] };
        result.calls.push({ id: `demo-call-${day + 1}`, residentId: id, source: 'imported', synthetic: true,
          status: 'completed', channel: 'pstn', startedAt, endedAt, durationSec: 240, createdAt: startedAt,
          localDate: localDate(new Date(startedAt), zone), analysisPending: false,
          summary, familySummary: summary,
          transcript: [
            { speaker: 'agent', text: 'How have your meals been?', startMs: 1000, endMs: 3000 },
            { speaker: 'resident', text: mealReply, startMs: 4000, endMs: 9000 },
            { speaker: 'agent', text: 'Has anyone been in touch?', startMs: 10000, endMs: 12500 },
            { speaker: 'resident', text: 'Yes, my family called yesterday. It was lovely to catch up.', startMs: 13000, endMs: 17000 },
          ],
          wellbeing: { tags, domains: domainStates(tags.map((t) => t.id)), headline: poorFood ? 'Little appetite, but enjoyed catching up with family.' : 'A comfortable day with good meals and family contact.' },
          analysis: { at: endedAt, turns: 4, intake: { date: localDate(new Date(startedAt), zone), status: poorFood ? 'poor' : 'normal' },
            memory: { topics: summary.topics, plans: [], likes: [] } },
        });
      }
      if (concern) {
        const urgency: Urgency = i === 0 ? 'urgent' : i === 1 ? 'action' : 'watch';
        const rule = i === 1 ? 'R3' as const : 'R2' as const;
        const summary = i === 0 ? 'Very little to eat for two days.' : i === 1 ? 'Taking longer to answer than their usual pattern.' : 'A small breakfast; check again at the next call.';
        result.cases.push({ id: `demo-${company.key}-case-${i + 1}`, orgId, residentId: id, rule, autoUrgency: urgency,
          status: i === 0 && companyIndex === 1 ? 'in_progress' : 'open',
          firstDetectedAt: latest.toISOString(), updatedAt: latest.toISOString(), notifications: [],
          detections: [{ residentId: id, rule, urgency, confidence: 0.9, detectedAt: latest.toISOString(), summary,
            evidence: i === 1 ? [] : [{ callId: 'demo-call-1', quote: i === 0 ? 'I have had very little to eat for two days.' : 'I only had a small breakfast today.', startMs: 4000, endMs: 9000 }] }],
        });
      }
    }
  }
  return result;
}
