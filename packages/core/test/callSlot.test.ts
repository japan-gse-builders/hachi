import { describe, expect, it } from 'vitest';
import { claimSlot, nextStaffCallSeq, slotBusy, staffCallCooldownLeft, staffCallId } from '../src/callSlot.js';

const NOW = new Date('2026-10-02T01:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('call slot (one line per resident)', () => {
  it('is free when nobody holds it, or when the holder has run out of time', () => {
    expect(slotBusy(undefined, NOW)).toBe(false);
    expect(slotBusy({ callId: 'a', at: NOW.toISOString(), until: NOW.toISOString() }, NOW)).toBe(false);
    expect(slotBusy({ callId: 'a', at: NOW.toISOString(), until: later(1) }, NOW)).toBe(true);
  });

  it('is never busy for the call that holds it', () => {
    expect(slotBusy({ callId: 'a', at: NOW.toISOString(), until: later(60_000) }, NOW, 'a')).toBe(false);
  });

  it('refuses a second call while the first holds the line', () => {
    const held = claimSlot(undefined, 'a', NOW, 60_000)!;
    expect(held).toEqual({ callId: 'a', at: NOW.toISOString(), until: later(60_000) });
    expect(claimSlot(held, 'b', NOW, 60_000)).toBeNull();
  });

  it('lets the holder extend it without moving when it began', () => {
    const held = claimSlot(undefined, 'a', NOW, 60_000)!;
    const extended = claimSlot(held, 'a', new Date(NOW.getTime() + 30_000), 600_000)!;
    expect(extended).toEqual({ callId: 'a', at: NOW.toISOString(), until: later(630_000) });
  });

  it('takes over a line whose holder never came back', () => {
    const stale = { callId: 'a', at: NOW.toISOString(), until: NOW.toISOString() };
    expect(claimSlot(stale, 'b', NOW, 60_000)).toMatchObject({ callId: 'b' });
  });
});

describe('staff call ids (issue #13)', () => {
  it('are a series of their own, apart from the daily id', () => {
    expect(staffCallId('2026-10-02', 1)).toBe('2026-10-02-now-1');
  });

  it('count up within a day and start again the next day', () => {
    expect(nextStaffCallSeq('2026-10-02', undefined)).toBe(1);
    expect(nextStaffCallSeq('2026-10-02', '2026-10-02-now-1')).toBe(2);
    expect(nextStaffCallSeq('2026-10-02', '2026-10-02-now-9')).toBe(10);
    expect(nextStaffCallSeq('2026-10-03', '2026-10-02-now-4')).toBe(1);
    expect(nextStaffCallSeq('2026-10-02', '2026-10-02-0')).toBe(1);
  });

  it('are spaced out by the cooldown', () => {
    expect(staffCallCooldownLeft(undefined, NOW, 600_000)).toBe(0);
    expect(staffCallCooldownLeft(NOW.toISOString(), new Date(NOW.getTime() + 60_000), 600_000)).toBe(540_000);
    expect(staffCallCooldownLeft(NOW.toISOString(), new Date(NOW.getTime() + 600_000), 600_000)).toBe(0);
  });
});
