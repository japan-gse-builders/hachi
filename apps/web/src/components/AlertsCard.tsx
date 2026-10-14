import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { enablePush, isStandalone, pushState, type PushState } from '../push';
import { LoadingCard } from './States';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

/** Nearly always shown at the foot of the family page, so it holds its place while the browser is asked what it supports. */
export function AlertsCard() {
  const { token } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setState, () => setState('unsupported'));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMessage('');
    try {
      const fcmToken = await enablePush();
      await api('/api/family/push-tokens', await token(), { method: 'POST', body: JSON.stringify({ token: fcmToken }) });
      setState('on');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not turn on alerts');
      setState(await pushState().catch((): PushState => 'unsupported'));
    } finally {
      setBusy(false);
    }
  };

  if (state === null) return <LoadingCard label="Alerts on this phone" action />;
  if (state === 'unconfigured') return null;

  return (
    <section className="card stack">
      <h2>Alerts on this phone</h2>
      {state === 'on' && <p className="notice-success" role="status">Alerts are on. Hachi will also text or email you if something urgent happens.</p>}
      {state === 'ready' && (
        <>
          <p>Get an alert on this phone as soon as Hachi notices something urgent.</p>
          <button type="button" onClick={() => void turnOn()} disabled={busy}>{busy ? 'Turning on…' : 'Turn on alerts'}</button>
        </>
      )}
      {state === 'needs-home-screen' && (
        <p>On iPhone, first add Hachi to your home screen: tap the Share button, then <strong>Add to Home Screen</strong>. Open Hachi from the home screen to turn on alerts.</p>
      )}
      {state === 'blocked' && <p>Alerts are blocked for this site. Allow notifications for Hachi in your phone settings, then reload.</p>}
      {state === 'unsupported' && <p className="meta">This browser cannot show alerts. Hachi will text or email you instead.</p>}
      {install && !isStandalone() && (
        <button type="button" className="ghost" onClick={() => void install.prompt().then(() => setInstall(null))}>Add Hachi to the home screen</button>
      )}
      {message && <p className="error" role="alert">{message}</p>}
    </section>
  );
}
