import { PRIVACY_NOTICE } from '../privacy';

/** Full details are available at enrollment and publicly, without a spoken recital. */
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
