import { sendSignInLinkToEmail, type Auth } from 'firebase/auth';
import { api } from './api';
import type { OrgInvitation } from './orgs';

type SavedInvitation = Pick<OrgInvitation, 'id' | 'email' | 'role' | 'expiresAt'>;
type EmailSender = (email: string) => Promise<void>;

/** Send to the invitee without remembering their address on the administrator's device. */
export async function sendInvitationLink(auth: Auth, email: string, origin: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, {
    url: `${origin}/staff/finish?invitation=1`,
    handleCodeInApp: true,
  });
}

export function invitationEmailError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
    return 'The email service has reached its sending limit. Try again later.';
  }
  if (code === 'auth/operation-not-allowed') return 'Email sign-in is not enabled. Ask the Hachi project owner to enable it.';
  if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
    return 'This website is not configured for sign-in emails. Ask the Hachi project owner to check its sign-in settings.';
  }
  if (code === 'auth/network-request-failed') return 'Check your connection and try again.';
  if (code === 'auth/invalid-email') return 'The email address was not accepted. Withdraw this invitation and check the address before inviting again.';
  return 'Try again using Send sign-in email below.';
}

/** A failed send must not disguise a saved invitation or cause a second one to be created. */
export async function inviteColleague(
  input: { email: string; role: 'member' | 'admin' },
  token: string,
  sendEmail: EmailSender,
): Promise<{ invitation: SavedInvitation; emailError: string | null }> {
  const invitation = await api<SavedInvitation>('/api/organization/invitations', token, {
    method: 'POST', body: JSON.stringify(input),
  });
  try {
    await sendEmail(invitation.email);
    return { invitation, emailError: null };
  } catch (error) {
    return { invitation, emailError: invitationEmailError(error) };
  }
}
