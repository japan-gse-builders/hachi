import { Link } from 'react-router';
import { PRIVACY_NOTICE } from '../privacy';
import { PrivacyNotice } from '../components/PrivacyNotice';
import { useDocumentTitle } from '../title';

export function PrivacyPage() {
  useDocumentTitle(PRIVACY_NOTICE.title);
  return (
    <article className="card stack narrow centered">
      <h1>{PRIVACY_NOTICE.title}</h1>
      <PrivacyNotice />
      <p className="back-link"><Link to="/"><span aria-hidden="true">← </span>Return to Hachi</Link></p>
    </article>
  );
}
