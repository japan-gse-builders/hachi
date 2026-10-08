import { PRIVACY_NOTICE } from '../privacy';

/** The exact same notice is read at enrollment and available without signing in. */
export function PrivacyNotice() {
  return (
    <div className="stack privacy-notice">
      <p>{PRIVACY_NOTICE.introduction}</p>
      {PRIVACY_NOTICE.sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
      <p className="meta">Notice version {PRIVACY_NOTICE.version}</p>
    </div>
  );
}
