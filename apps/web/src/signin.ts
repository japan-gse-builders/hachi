import type { Role } from './auth';

/** The role whose pages a path belongs to, or null for pages either role may open. */
export function sectionOf(path: string): Role | null {
  if (path === '/staff' || path.startsWith('/staff/')) return 'staff';
  if (path === '/family' || path.startsWith('/family/')) return 'family';
  return null;
}

/**
 * Where a sign-in page should send someone who already has a session, or null to show the form.
 *
 * Only a session that already holds the page's own role gets sent on. Any other session has to
 * see the form, because signing in is the only way to trade one role's session for the other's;
 * redirecting it away leaves a family contact unable to reach the staff form at all.
 * It goes on to its own section rather than to "/", which would pick whichever role is signed in.
 */
export function signInRedirect(page: Role, current: Role | null, from?: string): string | null {
  if (current !== page) return null;
  if (page === 'staff' && from?.startsWith('/staff')) return from;
  return `/${page}`;
}
