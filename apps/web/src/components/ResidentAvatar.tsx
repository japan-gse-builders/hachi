import { avatarDetails } from '../queue';

export function ResidentAvatar({ id, name }: { id: string; name: string }) {
  const { initials, color } = avatarDetails(id, name);
  // The adjacent full name carries the accessible identity; the colour conveys no clinical state.
  return <span className={`resident-avatar avatar-${color}`} aria-hidden="true">{initials}</span>;
}
