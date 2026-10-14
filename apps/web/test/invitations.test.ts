import { sendSignInLinkToEmail, type Auth } from 'firebase/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setActiveOrg } from '../src/api';
import { invitationEmailError, inviteColleague, sendInvitationLink } from '../src/invitations';

vi.mock('firebase/auth', () => ({ sendSignInLinkToEmail: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setActiveOrg(null);
});

const saved = { id: 'invite-1', email: 'colleague@example.org', role: 'admin' as const, expiresAt: '2026-10-28T12:00:00.000Z' };

describe('creating and emailing a colleague invitation', () => {
  it('saves an authorized invitation before emailing the address returned by the API', async () => {
    const events: string[] = [];
    setActiveOrg('org-1');
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer staff-token');
      expect(new Headers(init.headers).get('x-hachi-org')).toBe('org-1');
      events.push('saved');
      return new Response(JSON.stringify(saved), { status: 201 });
    });
    vi.stubGlobal('fetch', fetcher);
    const send = vi.fn(async () => { events.push('emailed'); });

    const result = await inviteColleague({ email: 'Colleague@Example.org', role: 'admin' }, 'staff-token', send);

    expect(events).toEqual(['saved', 'emailed']);
    expect(send).toHaveBeenCalledWith('colleague@example.org');
    expect(result).toEqual({ invitation: saved, emailError: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([403, 409])('does not email when the API refuses the invitation (%s)', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Invitation refused' }), { status })));
    const send = vi.fn();
    await expect(inviteColleague({ email: saved.email, role: 'admin' }, 'staff-token', send)).rejects.toBeInstanceOf(ApiError);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a saved invitation when email fails so a retry does not need another invitation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const send = vi.fn().mockRejectedValue({ code: 'auth/network-request-failed' });

    const result = await inviteColleague({ email: saved.email, role: 'admin' }, 'staff-token', send);

    expect(result.invitation.id).toBe('invite-1');
    expect(result.emailError).toContain('Check your connection');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('Firebase invitation emails', () => {
  it('sends a staff onboarding link without putting the email in the URL or changing the admin session', async () => {
    const admin = { uid: 'admin-1', email: 'admin@example.org' };
    const auth = { currentUser: admin } as Auth;
    const storage = { getItem: vi.fn(() => 'admin@example.org'), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('window', { localStorage: storage });
    vi.mocked(sendSignInLinkToEmail).mockResolvedValue(undefined);

    await sendInvitationLink(auth, saved.email, 'https://hachicall.web.app');

    expect(sendSignInLinkToEmail).toHaveBeenCalledWith(auth, saved.email, {
      url: 'https://hachicall.web.app/staff/finish?invitation=1', handleCodeInApp: true,
    });
    expect(auth.currentUser).toBe(admin);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('surfaces delivery failure instead of reporting a successful send', async () => {
    vi.mocked(sendSignInLinkToEmail).mockRejectedValue({ code: 'auth/quota-exceeded' });
    await expect(sendInvitationLink({} as Auth, saved.email, 'https://hachicall.web.app')).rejects.toEqual({ code: 'auth/quota-exceeded' });
  });

  it.each([
    ['auth/quota-exceeded', 'sending limit'],
    ['auth/too-many-requests', 'sending limit'],
    ['auth/operation-not-allowed', 'not enabled'],
    ['auth/unauthorized-continue-uri', 'sign-in settings'],
    ['auth/invalid-email', 'check the address'],
  ])('gives a useful next step for %s', (code, message) => {
    expect(invitationEmailError({ code })).toContain(message);
  });
});
