import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatWhen } from '../format';
import { hasCallConsent, PRIVACY_NOTICE, type ConsentWithdrawal } from '../privacy';
import type { Resident } from '../types';
import { CallConsentField } from './CallConsentField';

type Choice = 'withdraw-calls' | 'withdraw-family' | 'allow-calls' | 'allow-family';

const ACTIONS = {
  'withdraw-calls': 'Withdraw call consent',
  'withdraw-family': 'Withdraw family sharing',
  'allow-calls': 'Record call approval',
  'allow-family': 'Record family sharing approval',
};

function LastWithdrawal({ withdrawal }: { withdrawal: ConsentWithdrawal }) {
  return (
    <p className="meta">
      Last withdrawal by {withdrawal.name ?? withdrawal.by} on <time dateTime={withdrawal.at}>{formatWhen(withdrawal.at)} JST</time>.
    </p>
  );
}

export function ResidentConsentCard({ resident, canEdit, onSaved }: {
  resident: Resident;
  canEdit: boolean;
  onSaved: (resident: Resident) => void;
}) {
  const { token } = useAuth();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const calls = hasCallConsent(resident.callConsent);
  const family = resident.consent?.shareMood === true;

  const choose = (next: Choice) => {
    setChoice(next);
    setError('');
    setFeedback('');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!choice || busy || !canEdit) return;
    const body = {
      'withdraw-calls': { withdrawCallConsent: true, callConsentRevision: resident.callConsent?.lastWithdrawal?.revision },
      'withdraw-family': { shareMood: false, familySharingRevision: resident.consent?.lastWithdrawal?.revision },
      'allow-calls': { callConsent: { accepted: true, noticeVersion: PRIVACY_NOTICE.version, revision: resident.callConsent?.lastWithdrawal?.revision } },
      'allow-family': { shareMood: true, familySharingRevision: resident.consent?.lastWithdrawal?.revision },
    }[choice];
    setBusy(true);
    setError('');
    try {
      const saved = await api<Resident>(`/api/residents/${encodeURIComponent(resident.id)}`, await token(), { method: 'PATCH', body: JSON.stringify(body) });
      onSaved(saved);
      setFeedback(choice.startsWith('withdraw') ? 'Withdrawal recorded.' : 'Approval recorded.');
      setChoice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the consent choice.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack resident-consent" aria-labelledby="resident-consent-heading">
      <h2 id="resident-consent-heading">Consent</h2>
      <section className="stack stack-s" aria-labelledby="resident-call-consent">
        <h3 id="resident-call-consent">Calls</h3>
        <p>{calls ? 'Approved' : resident.callConsent?.lastWithdrawal ? 'Withdrawn' : 'Awaiting approval'}</p>
        {resident.callConsent?.lastWithdrawal && <LastWithdrawal withdrawal={resident.callConsent.lastWithdrawal} />}
        {canEdit && !choice && <div><button type="button" className="ghost" onClick={() => choose(calls ? 'withdraw-calls' : 'allow-calls')}>
          {ACTIONS[calls ? 'withdraw-calls' : 'allow-calls']}
        </button></div>}
      </section>
      <section className="stack stack-s" aria-labelledby="resident-family-consent">
        <h3 id="resident-family-consent">Family updates</h3>
        <p>{family ? 'Approved' : resident.consent?.lastWithdrawal ? 'Withdrawn' : resident.consent ? 'Declined' : 'Approval not recorded'}</p>
        <p className="meta">Call summaries, mood and loneliness updates.</p>
        {resident.consent?.lastWithdrawal && <LastWithdrawal withdrawal={resident.consent.lastWithdrawal} />}
        {canEdit && !choice && <div><button type="button" className="ghost" onClick={() => choose(family ? 'withdraw-family' : 'allow-family')}>
          {ACTIONS[family ? 'withdraw-family' : 'allow-family']}
        </button></div>}
      </section>
      {choice && (
        <form className="stack notice" onSubmit={(event) => void save(event)} aria-label={ACTIONS[choice]}>
          {choice === 'withdraw-calls' && <p>This stops new check-in calls, including scheduled calls and retries.</p>}
          {choice === 'withdraw-family' && <p>Family loses access to shared summaries and mood updates. Hachi will still send a basic alert in an emergency.</p>}
          {choice === 'allow-calls' && <CallConsentField required renewal={Boolean(resident.callConsent?.lastWithdrawal)} />}
          {choice === 'allow-family' && (
            <label className="check"><input type="checkbox" required />The patient agreed to share summaries, mood and loneliness updates with family.</label>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : ACTIONS[choice]}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setChoice(null)}>Cancel</button>
          </div>
        </form>
      )}
      {feedback && <p className="notice-success" role="status">{feedback}</p>}
    </section>
  );
}
