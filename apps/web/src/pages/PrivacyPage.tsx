import { Link } from 'react-router';
import { PRIVACY_NOTICE } from '../privacy';
import { PrivacyNotice } from '../components/PrivacyNotice';

export function PrivacyPage() {
  return (
    <main className="card stack narrow">
      <h1>{PRIVACY_NOTICE.title}</h1>
      <PrivacyNotice />
      <Link to="/">Return to Hachi</Link>
    </main>
  );
}
