import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseApp } from './auth';
import { needsHomeScreen } from './device';

const vapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) || undefined;

export type PushState = 'unconfigured' | 'unsupported' | 'needs-home-screen' | 'blocked' | 'ready' | 'on';

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export async function pushState(): Promise<PushState> {
  if (!firebaseApp || !vapidKey) return 'unconfigured';
  if (needsHomeScreen(navigator.userAgent, isStandalone())) return 'needs-home-screen';
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !(await isSupported())) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' ? 'on' : 'ready';
}

/** Asks for permission and returns the FCM token for this device. Call from a button press. */
export async function enablePush(): Promise<string> {
  if (!firebaseApp || !vapidKey) throw new Error('Alerts on this device are not set up yet');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Alerts were not allowed on this device');
  const serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js');
  return getToken(getMessaging(firebaseApp), { vapidKey, serviceWorkerRegistration });
}
