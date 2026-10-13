import type { Resident, ResidentOwner } from './types';

export type Ownership = 'mine' | 'theirs' | 'unassigned';

/** Only the responsible staff member can change a resident; the API enforces it, this only shows it. */
export function ownershipOf(r: Pick<Resident, 'owner'>, uid: string | undefined): Ownership {
  if (!r.owner) return 'unassigned';
  return uid !== undefined && r.owner.uid === uid ? 'mine' : 'theirs';
}

export function ownerName(owner: ResidentOwner): string {
  return owner.name ?? owner.email ?? 'Another member of staff';
}

/** The limit the API holds to; shown so nobody finds it by being refused. */
export const FAMILY_ACCESS_MAX = 5;
