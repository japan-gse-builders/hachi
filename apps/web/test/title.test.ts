import { describe, expect, it } from 'vitest';
import { queueLink } from '../src/queue';
import { pageTitle } from '../src/title';

describe('page titles', () => {
  it('names the screen before the product, and falls back to the product alone', () => {
    expect(pageTitle('Triage queue')).toBe('Triage queue · Hachi');
    expect(pageTitle()).toBe('Hachi');
    expect(pageTitle('')).toBe('Hachi');
  });
});

describe('back to the queue', () => {
  it('returns to the queue with the filters it was left with', () => {
    expect(queueLink({ queueSearch: 'urgency=urgent&q=tea' })).toBe('/staff?urgency=urgent&q=tea');
  });
  it('opens the plain queue for a pasted link or anything unexpected in history state', () => {
    expect(queueLink(null)).toBe('/staff');
    expect(queueLink(undefined)).toBe('/staff');
    expect(queueLink({ queueSearch: '' })).toBe('/staff');
    expect(queueLink({ queueSearch: 42 })).toBe('/staff');
  });
});
