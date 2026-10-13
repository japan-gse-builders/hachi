import { describe, expect, it } from 'vitest';
import { ownerName, ownershipOf } from '../src/ownership';

const owner = { uid: 'staff-1', email: 'tanaka@example.org', since: '2026-10-01T00:00:00.000Z' };

describe('ownershipOf', () => {
  it('tells mine, someone else’s and nobody’s apart', () => {
    expect(ownershipOf({ owner }, 'staff-1')).toBe('mine');
    expect(ownershipOf({ owner }, 'staff-2')).toBe('theirs');
    expect(ownershipOf({}, 'staff-1')).toBe('unassigned');
  });

  it('never treats a signed-out viewer as the owner', () => {
    expect(ownershipOf({ owner }, undefined)).toBe('theirs');
  });
});

describe('ownerName', () => {
  it('prefers the name, then the email', () => {
    expect(ownerName({ ...owner, name: 'Tanaka' })).toBe('Tanaka');
    expect(ownerName(owner)).toBe('tanaka@example.org');
    expect(ownerName({ uid: 'x', since: owner.since })).toBe('Another member of staff');
  });
});
