import { describe, expect, it } from 'vitest';
import { audioAt, callStatusLabel, clock, eventLabel, formatWhen, minutes, speakerLabel, speechLine, urgencyTone } from '../src/format';

describe('staff display helpers', () => {
  it('maps urgency to a tone and leaves unknown values calm', () => {
    expect(urgencyTone('emergency')).toBe('emergency');
    expect(urgencyTone('urgent')).toBe('urgent');
    expect(urgencyTone('mystery')).toBe('watch');
  });

  it('formats times in Japan and offsets inside a recording', () => {
    expect(formatWhen('2026-10-02T07:41:00.000Z')).toBe('2 Oct, 16:41');
    expect(formatWhen('not-a-date')).toBe('not-a-date');
    expect(clock(125000)).toBe('2:05');
    expect(clock(undefined)).toBe('');
  });

  it('labels transcript turns with the resident name, not the greeting name', () => {
    expect(speakerLabel('agent', 'Test Resident')).toBe('Hachi');
    expect(speakerLabel('resident', 'Test Resident')).toBe('Test Resident');
    expect(speakerLabel('resident', '  ')).toBe('Resident');
  });

  it('describes calls, history events and speech in plain words', () => {
    expect(callStatusLabel('no_answer')).toBe('No answer');
    expect(callStatusLabel('mystery')).toBe('mystery');
    expect(eventLabel('rank_changed')).toBe('Rank adjusted');
    expect(eventLabel('something_new')).toBe('something new');
    expect(minutes(64)).toBe('1:04');
    expect(minutes(null)).toBe('');
    expect(speechLine({ lexicalDiversity: 0.512, repairRate: 1.25, responseLatencyMs: 1500, topicCoherence: null })).toBe(
      'vocabulary 0.51 · self-corrections 1.3 · reply 1.5 s · coherence —',
    );
  });

  it('starts the recording at the quoted words', () => {
    expect(audioAt('https://x/a.wav?sig=1', 55400)).toBe('https://x/a.wav?sig=1#t=55');
    expect(audioAt('https://x/a.wav', undefined)).toBe('https://x/a.wav');
  });
});
