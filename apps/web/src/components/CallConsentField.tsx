import { PRIVACY_NOTICE } from '../privacy';
import { PrivacyNotice } from './PrivacyNotice';

export function CallConsentField({ required = false }: { required?: boolean }) {
  return (
    <fieldset className="stack">
      <legend>Before the first call</legend>
      <p>Read this short explanation to the resident and answer their questions. They can reply in their own words; they do not need to read a script aloud.</p>
      <blockquote>{PRIVACY_NOTICE.firstUsePrompt}</blockquote>
      <p><strong>A brief reply is enough:</strong> “{PRIVACY_NOTICE.agreement}”</p>
      <details>
        <summary>Full privacy notice and support</summary>
        <PrivacyNotice />
      </details>
      <label className="check">
        <input type="checkbox" name="callConsent" required={required} />
        I explained Hachi and answered their questions. The resident explicitly agreed.
      </label>
      {!required && <p className="meta">Leave unticked if they have not agreed. You can save their details now; calls will wait for approval.</p>}
    </fieldset>
  );
}
