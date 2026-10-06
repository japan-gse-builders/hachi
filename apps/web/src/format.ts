const TONE: Record<string, string> = {
  emergency: 'emergency',
  urgent: 'urgent',
  action: 'action',
  watch: 'watch',
};

export function urgencyTone(urgency: string): string {
  return TONE[urgency] ?? 'watch';
}

/** preferredName is how Hachi greets the resident (it can be "there"), so it is not a label. */
export function speakerLabel(speaker: 'resident' | 'agent', residentName: string): string {
  if (speaker === 'agent') return 'Hachi';
  return residentName.trim() || 'Resident';
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

const CALL_STATUS: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Talked',
  no_answer: 'No answer',
  failed: 'Could not connect',
};

export function callStatusLabel(status: string): string {
  return CALL_STATUS[status] ?? status;
}

const EVENT_TYPE: Record<string, string> = {
  urgency_changed: 'Urgency changed',
  rank_changed: 'Rank adjusted',
  status_changed: 'Status changed',
  closed: 'Closed',
};

export function eventLabel(type: string): string {
  return EVENT_TYPE[type] ?? type.replace(/_/g, ' ');
}

const FEATURE: [string, string, (v: number) => string][] = [
  ['lexicalDiversity', 'vocabulary', (v) => v.toFixed(2)],
  ['repairRate', 'self-corrections', (v) => v.toFixed(1)],
  ['responseLatencyMs', 'reply', (v) => `${(v / 1000).toFixed(1)} s`],
  ['topicCoherence', 'coherence', (v) => v.toFixed(2)],
];

export function speechLine(features: Record<string, number | null>): string {
  return FEATURE.map(([key, label, show]) => {
    const v = features[key];
    return `${label} ${v === null || v === undefined ? '—' : show(v)}`;
  }).join(' · ');
}

const CHANNEL: Record<string, string> = {
  sms: 'text message',
  email: 'email',
  push: 'app alert',
  voice: 'phone call',
};

export function channelList(channels: string[]): string {
  return channels.map((c) => CHANNEL[c] ?? c).join(', ');
}

export interface Delivery {
  status: string | null;
  errorCode?: string | null;
}

const DELIVERY: Record<string, string> = {
  queued: 'Sending',
  sending: 'Sending',
  sent: 'Sent',
  ringing: 'Ringing',
  delivered: 'Delivered',
  answered: 'Answered',
  undelivered: 'Not delivered',
  failed: 'Not delivered',
  no_answer: 'No answer',
  busy: 'Line busy',
  canceled: 'Cancelled',
};

/** Twilio error codes staff are likely to see for texts to Japanese phones. */
const DELIVERY_ERROR: Record<string, string> = {
  '30003': 'phone unreachable',
  '30004': 'blocked',
  '30005': 'unknown number',
  '30006': 'landline or unreachable carrier',
  '30007': 'carrier blocked',
  '30008': 'carrier error',
};

/** Without a provider report (email, app alerts, or before the carrier answers) the honest label is "Sent". */
export function deliveryLabel(d: Delivery | null | undefined): string {
  const label = (d?.status && DELIVERY[d.status]) || 'Sent';
  if (!d?.errorCode) return label;
  const reason = DELIVERY_ERROR[d.errorCode];
  return `${label} (${reason ? `${reason}, ` : ''}code ${d.errorCode})`;
}

/** Family view: plain words, no error codes, and only reports that tell them something. */
export function familyDeliveryList(deliveries: ({ channel: string } & Delivery)[]): string {
  return deliveries
    .map((d) => {
      const name = CHANNEL[d.channel] ?? d.channel;
      const label = d.status ? DELIVERY[d.status] : undefined;
      return label && label !== 'Sent' && label !== 'Sending' ? `${name} (${label.toLowerCase()})` : name;
    })
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(', ');
}

/** Each topic arrives as its own capitalised phrase, so commas would leave capitals mid-sentence. */
export function topicList(topics: string[]): string {
  return topics.join(' · ');
}

/** Japanese numbers as people dial them at home; area-code lengths vary, so only mobile and free-dial get hyphens. */
export function phoneDisplay(e164: string): string {
  const m = /^\+81(\d{9,10})$/.exec(e164);
  if (!m) return e164;
  const n = `0${m[1]}`;
  if (/^0[5789]0\d{8}$/.test(n)) return `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
  if (/^0120\d{6}$/.test(n)) return `${n.slice(0, 4)}-${n.slice(4, 7)}-${n.slice(7)}`;
  return n;
}

export function minutes(sec: number | null): string {
  return sec === null ? '' : clock(sec * 1000);
}

/** Media fragment so the player starts at the quoted words. */
export function audioAt(url: string, startMs: number | undefined): string {
  return startMs === undefined ? url : `${url}#t=${Math.floor(startMs / 1000)}`;
}

/** Numbered Kihon items as prose, because "item 23, 24 cannot be asked" reads as a single item. */
export function itemList(ns: number[]): string {
  if (ns.length === 1) return `item ${ns[0]}`;
  return `items ${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`;
}

export interface Instrument {
  score: number;
  answered: number;
  of: number;
  askable?: number;
  cutoff?: number;
  positive: boolean | null;
}

/**
 * Three different things a part-answered instrument can mean, kept apart because they ask different
 * things of the reader. An instrument short of items by telephone will never be readable and that is
 * nothing to wait for; one short of answers will be readable once the rotation gets there.
 */
export function instrumentLine(i: Instrument): string {
  const cutoff = i.cutoff === undefined ? 'its cutoff' : `its cutoff of ${i.cutoff}`;
  if (i.positive !== null) return `${i.score}, ${i.positive ? 'at or above' : 'below'} ${cutoff}`;
  if (i.askable !== undefined && i.askable < i.of)
    return `only ${i.askable} of its ${i.of} items can be asked by telephone, so Hachi never reports a result for it. ${i.answered} answered, scoring ${i.score}`;
  return `answered ${i.answered} of ${i.of}, so it cannot be read yet`;
}

export function clock(ms: number | undefined): string {
  if (ms === undefined) return '';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
