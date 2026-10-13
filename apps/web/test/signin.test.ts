import { describe, expect, it } from 'vitest';
import { sectionOf, signInRedirect } from '../src/signin';

describe('who a sign-in page sends on and who sees the form', () => {
  it('sends a staff session on to the page it was heading for', () => {
    expect(signInRedirect('staff', 'staff', '/staff/cases/abc')).toBe('/staff/cases/abc');
    expect(signInRedirect('staff', 'staff')).toBe('/staff');
    expect(signInRedirect('staff', 'staff', '/family/residents/abc')).toBe('/staff');
  });

  it('shows the staff form to a family session instead of bouncing it to the family pages', () => {
    expect(signInRedirect('staff', 'family')).toBeNull();
    expect(signInRedirect('staff', 'family', '/staff/residents')).toBeNull();
  });

  it('shows the family form to a staff session', () => {
    expect(signInRedirect('family', 'staff')).toBeNull();
    expect(signInRedirect('family', 'family')).toBe('/family');
  });

  it('shows either form when nobody is signed in', () => {
    expect(signInRedirect('staff', null)).toBeNull();
    expect(signInRedirect('family', null)).toBeNull();
  });
});

describe('which session a page uses', () => {
  it('reads the section from the path, not from a lookalike prefix', () => {
    expect(sectionOf('/staff')).toBe('staff');
    expect(sectionOf('/staff/finish')).toBe('staff');
    expect(sectionOf('/family/residents/abc')).toBe('family');
    expect(sectionOf('/staffroom')).toBeNull();
    expect(sectionOf('/privacy')).toBeNull();
    expect(sectionOf('/')).toBeNull();
  });
});
