import { PRIVACY_NOTICE } from '../privacy';
import { PrivacyNotice } from './PrivacyNotice';

export function CallConsentField({ required = false }: { required?: boolean }) {
  return (
    <fieldset className="stack">
      <legend>Before the first call</legend>
      <p>Read this notice to the resident, answer their questions, then ask whether they agree.</p>
      <PrivacyNotice />
      <blockquote>{PRIVACY_NOTICE.agreement}</blockquote>
      <label className="check">
        <input type="checkbox" name="callConsent" required={required} />
        I read the notice to the resident and they explicitly agreed.
      </label>
      {!required && <p className="meta">Leave unticked if they have not agreed. You can save their details now; calls will wait for approval.</p>}
    </fieldset>
  );
}
