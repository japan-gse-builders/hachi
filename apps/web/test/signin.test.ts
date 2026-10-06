import { describe, expect, it } from 'vitest';
import { signInRedirect } from '../src/signin';

describe('who a sign-in page sends on and who sees the form', () => {
  it('sends a staff session on to the page it was heading for', () => {
    expect(signInRedirect('staff', 'staff', '/staff/cases/abc')).toBe('/staff/cases/abc');
    expect(signInRedirect('staff', 'staff')).toBe('/');
    expect(signInRedirect('staff', 'staff', '/family/residents/abc')).toBe('/');
  });

  it('shows the staff form to a family session instead of bouncing it to the family pages', () => {
    expect(signInRedirect('staff', 'family')).toBeNull();
    expect(signInRedirect('staff', 'family', '/staff/residents')).toBeNull();
  });

  it('shows the family form to a staff session', () => {
    expect(signInRedirect('family', 'staff')).toBeNull();
    expect(signInRedirect('family', 'family')).toBe('/');
  });

  it('shows either form when nobody is signed in', () => {
    expect(signInRedirect('staff', null)).toBeNull();
    expect(signInRedirect('family', null)).toBeNull();
  });
});
