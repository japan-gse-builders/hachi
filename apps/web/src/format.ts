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

export function minutes(sec: number | null): string {
  return sec === null ? '' : clock(sec * 1000);
}

/** Media fragment so the player starts at the quoted words. */
export function audioAt(url: string, startMs: number | undefined): string {
  return startMs === undefined ? url : `${url}#t=${Math.floor(startMs / 1000)}`;
}

export function clock(ms: number | undefined): string {
  if (ms === undefined) return '';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
