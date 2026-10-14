import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../src/auth';
import { FamilyFinishPage } from '../src/pages/FamilyFinishPage';

vi.mock('../src/auth', () => ({ useAuth: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function renderFinish(path: string, options: { signedIn?: boolean; valid?: boolean } = {}) {
  vi.stubGlobal('window', { location: { href: `https://hachicall.web.app${path}` } });
  const storedLinkEmail = vi.fn(() => 'someone-else@example.org');
  vi.mocked(useAuth).mockReturnValue({
    user: options.signedIn ? { email: 'admin@example.org' } : null,
    ready: true,
    isSignInLink: () => options.valid ?? true,
    storedLinkEmail,
    finishSignInLink: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(FamilyFinishPage)));
  return { html, storedLinkEmail };
}

describe('opening a staff invitation email', () => {
  it('asks for the invited address even when the browser belongs to another signed-in staff member', () => {
    const { html, storedLinkEmail } = renderFinish('/staff/finish?invitation=1&oobCode=test', { signedIn: true });
    expect(html).toContain('Join your team on Hachi');
    expect(html).toContain('admin@example.org');
    expect(html).toContain('value=""');
    expect(html).not.toContain('someone-else@example.org');
    expect(storedLinkEmail).not.toHaveBeenCalled();
  });

  it('does not trust an email address included in a forwarded URL', () => {
    const { html } = renderFinish('/staff/finish?invitation=1&email=untrusted@example.org&oobCode=test');
    expect(html).toContain('value=""');
    expect(html).not.toContain('untrusted@example.org');
  });

  it('still remembers the address for a normal self-requested sign-in link', () => {
    const { html } = renderFinish('/staff/finish?oobCode=test');
    expect(html).toContain('value="someone-else@example.org"');
    expect(html).toContain('Confirm your email');
  });

  it('offers recovery for an invalid invitation link instead of claiming the account joined', () => {
    const { html } = renderFinish('/staff/finish?invitation=1', { valid: false });
    expect(html).toContain('This link does not work');
    expect(html).toContain('/staff/login');
  });
});
