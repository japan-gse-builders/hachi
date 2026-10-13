import { useState } from 'react';
import { avatarDetails } from '../queue';
import type { Portrait } from '../types';

/** The illustrations staff choose from, with words for anyone who cannot see them. */
export const PORTRAITS: { id: Portrait; label: string }[] = [
  { id: 'grandmother-1', label: 'Grandmother with a grey bob, in a lilac kimono' },
  { id: 'grandmother-2', label: 'Grandmother with white curls and glasses, knitting' },
  { id: 'grandmother-3', label: 'Grandmother in a red beret and brown coat' },
  { id: 'grandmother-4', label: 'Grandmother with grey curls and glasses, holding a cat' },
  { id: 'grandmother-5', label: 'Grandmother in an orange headscarf and earrings' },
  { id: 'grandfather-1', label: 'Grandfather in a flat cap and navy jacket' },
  { id: 'grandfather-2', label: 'Grandfather with grey hair and a green cardigan, with a cane' },
  { id: 'grandfather-3', label: 'Grandfather in a bucket hat, with a backpack' },
  { id: 'grandfather-4', label: 'Grandfather with a white beard and glasses, with a coffee' },
  { id: 'grandfather-5', label: 'Grandfather with a grey beard, in a hooded jacket' },
];

export const portraitSrc = (id: Portrait) => `/avatars/${id}.png`;

export function ResidentAvatar({ id, name, portrait }: { id: string; name: string; portrait?: Portrait | null | undefined }) {
  const { initials, color } = avatarDetails(id, name);
  const [missing, setMissing] = useState<string | null>(null);
  const src = portrait ? portraitSrc(portrait) : null;
  // The adjacent full name carries the accessible identity; the colour conveys no clinical state.
  if (src && missing !== src) {
    return (
      <span className={`resident-avatar avatar-${color} has-portrait`} aria-hidden="true">
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setMissing(src)} />
      </span>
    );
  }
  return <span className={`resident-avatar avatar-${color}`} aria-hidden="true">{initials}</span>;
}
