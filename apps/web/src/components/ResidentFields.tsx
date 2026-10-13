import type { Resident } from '../types';
import { PORTRAITS, portraitSrc } from './ResidentAvatar';

/**
 * The resident's details, their care-team contact and their family contact, as one set of fields
 * for both adding and editing. Read back with `readResidentForm`.
 */
export function ResidentFields({ resident }: { resident?: Resident }) {
  const v = resident?.vulnerability;
  const staff = resident?.staff;
  const family = resident?.family;
  return (
    <>
      <fieldset>
        <legend>Patient</legend>
        <div className="field-grid">
          <label>Full name<input name="name" required maxLength={100} defaultValue={resident?.name} /></label>
          <label>Name Hachi should use<input name="preferredName" required maxLength={50} defaultValue={resident?.preferredName} /></label>
          <label>Mobile number<input name="phone" type="tel" required placeholder="+819012345678" spellCheck={false} defaultValue={resident?.phone} /></label>
          <label>Daily call time
            <input name="callTime" required defaultValue={resident?.callTime ?? '10:00'} pattern="([01]\d|2[0-3]):[0-5]\d" title="Use 24-hour time, such as 09:30" aria-describedby="call-time-hint" />
            <span id="call-time-hint" className="hint">24-hour time, Japan time</span>
          </label>
        </div>
        <div className="portrait-field" role="radiogroup" aria-labelledby="portrait-label">
          <span id="portrait-label" className="control-label">Picture beside their name</span>
          <div className="portrait-options">
            {PORTRAITS.map((p) => (
              <label key={p.id} className="portrait-option" title={p.label}>
                <input type="radio" name="portrait" value={p.id} defaultChecked={resident?.portrait === p.id} />
                <img src={portraitSrc(p.id)} alt="" className="portrait-preview" />
                <span className="sr-only">{p.label}</span>
              </label>
            ))}
            <label className="portrait-option portrait-option-none">
              <input type="radio" name="portrait" value="" defaultChecked={!resident?.portrait} />
              <span className="portrait-preview portrait-initials" aria-hidden="true">AB</span>
              <span>Initials only</span>
            </label>
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Circumstances used for ranking</legend>
        <div className="checks">
          <label className="check"><input name="livesAlone" type="checkbox" defaultChecked={v?.livesAlone} />Lives alone</label>
          <label className="check"><input name="hasCloseSupporter" type="checkbox" defaultChecked={v?.hasCloseSupporter} />Has someone nearby</label>
          <label className="check"><input name="needsCare" type="checkbox" defaultChecked={v?.needsCare} />Needs care</label>
        </div>
        <label><span>Ongoing conditions, separated by commas <span className="hint">(optional)</span></span><input name="conditions" defaultValue={v?.chronicConditions.join(', ')} /></label>
        <label><span>Household notes <span className="hint">(optional)</span></span><textarea name="householdNotes" rows={2} maxLength={1000} defaultValue={resident?.householdNotes} /></label>
      </fieldset>
      <fieldset>
        <legend>Staff in charge</legend>
        <p className="meta">Alerts go by text message or email, so enter at least one of them.</p>
        <div className="field-grid">
          <label>Staff name<input name="staffName" required maxLength={100} defaultValue={staff?.name} /></label>
          <label>Staff phone, for emergency calls<input name="staffPhone" type="tel" required placeholder="+81312345678" spellCheck={false} defaultValue={staff?.phone} /></label>
          <label>Staff mobile for text alerts<input name="staffSms" type="tel" placeholder="+819012345678" spellCheck={false} defaultValue={staff?.sms} /></label>
          <label>Staff email<input name="staffEmail" type="email" spellCheck={false} defaultValue={staff?.email} /></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Family member (optional)</legend>
        <p className="meta">
          If you add one, enter a name and a mobile number or an email address.
          {resident && ' Empty every field to remove the family contact; they will stop getting alerts.'}
        </p>
        <div className="field-grid">
          <label>Family name<input name="familyName" maxLength={100} defaultValue={family?.name} /></label>
          <label>Relationship<input name="familyRelationship" maxLength={50} placeholder="Daughter" defaultValue={family?.relationship} /></label>
          <label>Family mobile<input name="familySms" type="tel" placeholder="+819012345678" spellCheck={false} defaultValue={family?.sms} /></label>
          <label>Family email<input name="familyEmail" type="email" spellCheck={false} defaultValue={family?.email} /></label>
        </div>
      </fieldset>
    </>
  );
}

/**
 * What `ResidentFields` holds, in the API's shape. Empty optional fields are left out; with
 * `clearing`, as when editing, an empty picture, notes or family contact is sent as cleared instead.
 */
export function readResidentForm(form: FormData, { clearing = false }: { clearing?: boolean } = {}) {
  const text = (name: string) => String(form.get(name) ?? '').trim();
  const optional = (key: string, name: string) => (text(name) ? { [key]: text(name) } : {});
  const hasFamily = ['familyName', 'familyRelationship', 'familySms', 'familyEmail'].some((name) => text(name));
  const portrait = text('portrait');
  return {
    name: text('name'),
    preferredName: text('preferredName'),
    phone: text('phone'),
    callTime: text('callTime'),
    vulnerability: {
      livesAlone: form.get('livesAlone') === 'on',
      hasCloseSupporter: form.get('hasCloseSupporter') === 'on',
      needsCare: form.get('needsCare') === 'on',
      chronicConditions: text('conditions') ? text('conditions').split(',').map((s) => s.trim()).filter(Boolean) : [],
    },
    ...(clearing ? { householdNotes: text('householdNotes') } : optional('householdNotes', 'householdNotes')),
    ...(portrait ? { portrait } : clearing ? { portrait: null } : {}),
    staff: { name: text('staffName'), phone: text('staffPhone'), ...optional('sms', 'staffSms'), ...optional('email', 'staffEmail') },
    ...(hasFamily
      ? {
          family: {
            name: text('familyName'),
            ...optional('relationship', 'familyRelationship'),
            ...optional('sms', 'familySms'),
            ...optional('email', 'familyEmail'),
          },
        }
      : clearing ? { family: null } : {}),
  };
}
