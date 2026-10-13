import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the infra scripts for organizations (migrate, verify, add a member) against the Firestore and Auth emulators
 * (`npm run test:emulator`). Its own project id keeps it apart from the store contract tests,
 * which clear the default project's database before every test.
 */
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = 'demo-hachi-migration';
const ORG = 'org-sakura-home-care';
const script = fileURLToPath(new URL('../../../infra/migrate-organizations.mjs', import.meta.url));
const addMemberScript = fileURLToPath(new URL('../../../infra/add-member.mjs', import.meta.url));
const verifyScript = fileURLToPath(new URL('../../../infra/verify-organization.mjs', import.meta.url));
const run = promisify(execFile);

async function migrate(...args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, PROJECT, ...args], { env: { ...process.env } });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe.skipIf(!firestoreHost || !authHost)('migrate-organizations (emulators)', { timeout: 15_000 }, () => {
  let db: import('firebase-admin/firestore').Firestore;
  const uids: Record<string, string> = {};
  const owner = ['--name', 'Sakura Home Care', '--owner', 'Owner@Example.org'];

  const doc = async (path: string) => (await db.doc(path).get()).data();

  beforeAll(async () => {
    await fetch(`http://${firestoreHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
    const { initializeApp } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app = initializeApp({ projectId: PROJECT }, 'migration-test');
    const auth = getAuth(app);
    db = getFirestore(app);

    const users = [
      { key: 'owner', email: 'owner@example.org', emailVerified: true, claims: { role: 'staff' } },
      { key: 'colleague', email: 'colleague@example.org', emailVerified: false, claims: { role: 'staff' }, displayName: 'Yuki Sato' },
      { key: 'disabled', email: 'gone@example.org', emailVerified: true, claims: { role: 'staff' }, disabled: true },
      { key: 'family', email: 'family@example.org', emailVerified: true, claims: null },
    ];
    for (const { key, claims, ...fields } of users) {
      const u = await auth.createUser(fields);
      if (claims) await auth.setCustomUserClaims(u.uid, claims);
      uids[key] = u.uid;
    }

    const at = '2026-10-01T00:00:00.000Z';
    await Promise.all([
      db.doc('residents/r-legacy').set({ id: 'r-legacy', name: 'A', updatedAt: at }),
      db.doc('residents/r-other').set({ id: 'r-other', orgId: 'org-other', name: 'B', updatedAt: at }),
      db.doc('cases/c-legacy').set({ id: 'c-legacy', residentId: 'r-legacy', status: 'open' }),
      db.doc('cases/c-of-other').set({ id: 'c-of-other', residentId: 'r-other', status: 'open' }),
      db.doc('cases/c-orphan').set({ id: 'c-orphan', residentId: 'r-missing', status: 'closed' }),
      db.doc('outbox/o-of-other').set({ id: 'o-of-other', residentId: 'r-other', status: 'sent' }),
      db.doc('outbox/o-stamped').set({ id: 'o-stamped', residentId: 'r-legacy', orgId: 'org-x', status: 'sent' }),
    ]);
  });

  it('rejects bad arguments and an owner who is not staff', async () => {
    expect((await migrate('--name', 'X')).code).toBe(1);
    expect((await migrate(...owner, '--bogus')).code).toBe(1);
    expect((await migrate(...owner, '--time-zone', 'Mars/Olympus')).out).toContain('Unknown time zone');
    expect((await migrate(...owner, '--org-id', 'has_underscore')).code).toBe(1);
    const notStaff = await migrate('--name', 'Sakura Home Care', '--owner', 'family@example.org');
    expect(notStaff.code).toBe(1);
    expect(notStaff.out).toContain('f***@example.org');
    expect(notStaff.out).not.toContain('family@example.org');
  });

  it('writes nothing on a dry run', async () => {
    const dry = await migrate(...owner);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('Dry run: nothing written');
    expect(dry.out).toContain('2 membership(s) to create');
    expect(dry.out).toContain('residents: 2 document(s), 1 without an orgId');
    expect(dry.out).not.toContain('owner@example.org');
    expect(await doc(`organizations/${ORG}`)).toBeUndefined();
    expect((await doc('residents/r-legacy'))?.orgId).toBeUndefined();
  });

  it('creates the organization, its members and every missing orgId', async () => {
    const applied = await migrate(...owner, '--apply');
    expect(applied.code).toBe(0);
    expect(applied.out).toContain('WARNING: email not verified');

    expect(await doc(`organizations/${ORG}`)).toMatchObject({
      id: ORG,
      name: 'Sakura Home Care',
      timeZone: 'Asia/Tokyo',
      status: 'active',
      verifiedBy: 'migration',
      verifiedAt: expect.any(String),
      createdBy: 'migration',
      billing: { plan: 'internal', email: 'owner@example.org', limits: { residents: 1000, members: 200 } },
    });
    expect(await doc(`memberships/${ORG}_${uids.owner}`)).toMatchObject({ orgId: ORG, uid: uids.owner, email: 'owner@example.org', role: 'owner', status: 'active' });
    expect(await doc(`memberships/${ORG}_${uids.colleague}`)).toMatchObject({ role: 'admin', name: 'Yuki Sato', email: 'colleague@example.org' });
    expect(await doc(`memberships/${ORG}_${uids.disabled}`)).toBeUndefined();
    expect(await doc(`memberships/${ORG}_${uids.family}`)).toBeUndefined();
    const audit = await db.collection(`organizations/${ORG}/audit`).get();
    expect(audit.docs.map((d) => d.data())).toEqual([expect.objectContaining({ action: 'organization.created', actor: { uid: 'migration' }, orgId: ORG })]);

    expect((await doc('residents/r-legacy'))?.orgId).toBe(ORG);
    expect((await doc('residents/r-other'))?.orgId).toBe('org-other');
    expect((await doc('cases/c-legacy'))?.orgId).toBe(ORG);
    expect((await doc('cases/c-of-other'))?.orgId).toBe('org-other');
    expect((await doc('cases/c-orphan'))?.orgId).toBe(ORG);
    expect((await doc('outbox/o-of-other'))?.orgId).toBe('org-other');
    expect((await doc('outbox/o-stamped'))?.orgId).toBe('org-x');
  });

  it('changes nothing that is already there when run again', async () => {
    await db.doc(`memberships/${ORG}_${uids.colleague}`).update({ role: 'member' });
    await db.doc(`organizations/${ORG}`).update({ name: 'Renamed since' });
    await db.doc('residents/r-late').set({ id: 'r-late', name: 'C' });

    const again = await migrate(...owner, '--apply');
    expect(again.code).toBe(0);
    expect(again.out).toContain('0 membership(s) to create');
    expect(again.out).toContain('residents: 3 document(s), 1 without an orgId');
    expect(again.out).toContain('cases: 3 document(s), 0 without an orgId');

    expect((await doc(`memberships/${ORG}_${uids.colleague}`))?.role).toBe('member');
    expect((await doc(`organizations/${ORG}`))?.name).toBe('Renamed since');
    expect((await doc('residents/r-late'))?.orgId).toBe(ORG);
    expect((await db.collection(`organizations/${ORG}/audit`).get()).size).toBe(1);
  });

  it('never brings back someone removed since, though their account keeps the legacy claim', async () => {
    expect((await doc(`migrations/organizations-${ORG}`))?.members).toEqual(expect.arrayContaining([uids.owner, uids.colleague]));
    await db.doc(`memberships/${ORG}_${uids.colleague}`).delete();
    const again = await migrate(...owner, '--apply');
    expect(again.out).toContain('0 membership(s) to create');
    expect(await doc(`memberships/${ORG}_${uids.colleague}`)).toBeUndefined();
  });

  it('moves nothing into an existing organization that is not verified, nor verifies it', async () => {
    const other = 'org-self-serve';
    await db.doc(`organizations/${other}`).set({ id: other, name: 'Self Serve', status: 'active', updatedAt: '2026-10-01T00:00:00.000Z' });
    await db.doc('residents/r-later').set({ id: 'r-later', name: 'D' });
    for (const extra of [[], ['--apply']]) {
      const refused = await migrate(...owner, '--org-id', other, ...extra);
      expect(refused.code).toBe(1);
      expect(refused.out).toContain('is not verified');
      expect(refused.out).toContain('verify-organization.mjs');
    }
    expect((await doc(`organizations/${other}`))?.verifiedAt).toBeUndefined();
    expect(await doc(`memberships/${other}_${uids.owner}`)).toBeUndefined();
    expect((await doc('residents/r-later'))?.orgId).toBeUndefined();
    // Once verified on purpose, it is used as it is.
    await db.doc(`organizations/${other}`).update({ verifiedAt: '2026-10-02T00:00:00.000Z', verifiedBy: 'ops@hachi.example' });
    const used = await migrate(...owner, '--org-id', other, '--apply');
    expect(used.code).toBe(0);
    expect(used.out).toContain('verified); not changed');
    expect((await doc('residents/r-later'))?.orgId).toBe(other);
  });

  it('will not take the next option as a value', async () => {
    const res = await migrate('--name', 'Sakura Home Care', '--owner', 'owner@example.org', '--org-id', '--apply');
    expect(res.code).toBe(1);
    expect(res.out).toContain('--org-id needs a value');
    expect(await doc('organizations/--apply')).toBeUndefined();
  });

  describe('verify-organization', () => {
    const verify = async (...args: string[]) => {
      try {
        const { stdout, stderr } = await run(process.execPath, [verifyScript, PROJECT, ...args], { env: { ...process.env } });
        return { code: 0, out: stdout + stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { code: e.code ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
      }
    };
    const TRIAL = 'org-trial';

    beforeAll(async () => {
      await db.doc(`organizations/${TRIAL}`).set({
        id: TRIAL,
        name: 'Trial Care',
        status: 'active',
        billing: { plan: 'trial', email: 'boss@trial.example', limits: { residents: 5, members: 3 } },
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      await db.doc(`memberships/${TRIAL}_u-boss`).set({ orgId: TRIAL, uid: 'u-boss', email: 'boss@trial.example', role: 'owner', status: 'active' });
    });

    it('refuses bad input, and needs to know who is verifying', async () => {
      expect((await verify(TRIAL)).code).toBe(1);
      expect((await verify(TRIAL, '--by')).code).toBe(1);
      expect((await verify(TRIAL, '--by', 'not-an-email')).code).toBe(1);
      expect((await verify(TRIAL, '--by', 'ops@hachi.example', '--bogus')).code).toBe(1);
      expect((await verify('org-nope', '--by', 'ops@hachi.example')).out).toContain('No organization org-nope');
      expect((await verify('a/b', '--by', 'ops@hachi.example')).code).toBe(1);
      expect((await verify(TRIAL, '--by', '--apply')).code).toBe(1);
    });

    it('shows who owns it and changes nothing without --apply', async () => {
      const dry = await verify(TRIAL, '--by', 'ops@hachi.example');
      expect(dry.code).toBe(0);
      expect(dry.out).toContain('owners: boss@trial.example');
      expect(dry.out).toContain('not verified');
      expect(dry.out).toContain('Would verify it');
      expect((await doc(`organizations/${TRIAL}`))?.verifiedAt).toBeUndefined();
    });

    it('verifies, records who did it, and withdraws it again', async () => {
      expect((await verify(TRIAL, '--by', 'Ops@Hachi.example', '--apply')).out).toContain('"Trial Care" verified');
      expect(await doc(`organizations/${TRIAL}`)).toMatchObject({ verifiedBy: 'ops@hachi.example', verifiedAt: expect.any(String), name: 'Trial Care' });
      expect((await verify(TRIAL, '--by', 'ops@hachi.example', '--apply')).out).toContain('Already verified');

      expect((await verify(TRIAL, '--by', 'ops@hachi.example', '--revoke')).out).toContain('Would withdraw');
      expect((await doc(`organizations/${TRIAL}`))?.verifiedAt).toBeDefined();
      expect((await verify(TRIAL, '--by', 'ops@hachi.example', '--revoke', '--apply')).out).toContain('"Trial Care" withdrawn');
      const after = (await doc(`organizations/${TRIAL}`))!;
      expect(after.verifiedAt).toBeUndefined();
      expect(after.verifiedBy).toBeUndefined();
      expect(after).toMatchObject({ name: 'Trial Care', billing: { plan: 'trial' } });

      const audit = (await db.collection(`organizations/${TRIAL}/audit`).orderBy('id').get()).docs.map((d) => d.data());
      expect(audit.map((a) => [a.action, a.actor])).toEqual([
        ['organization.verified', { uid: 'operator', email: 'ops@hachi.example' }],
        ['organization.unverified', { uid: 'operator', email: 'ops@hachi.example' }],
      ]);
    });
  });

  describe('add-member', () => {
    const addMember = async (...args: string[]) => {
      try {
        const { stdout, stderr } = await run(process.execPath, [addMemberScript, PROJECT, ...args], { env: { ...process.env } });
        return { code: 0, out: stdout + stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { code: e.code ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
      }
    };

    it('adds an account directly, and changes the role of an existing member', async () => {
      expect((await addMember(ORG, 'family@example.org')).code).toBe(0);
      expect(await doc(`memberships/${ORG}_${uids.family}`)).toMatchObject({ orgId: ORG, uid: uids.family, role: 'member', status: 'active', email: 'family@example.org' });
      expect((await addMember(ORG, 'family@example.org', 'admin')).out).toContain('updated as admin');
      expect((await doc(`memberships/${ORG}_${uids.family}`))?.role).toBe('admin');
    });

    it('will not demote the last owner, and refuses bad input', async () => {
      const demote = await addMember(ORG, 'owner@example.org', 'admin');
      expect(demote.code).toBe(1);
      expect(demote.out).toContain('last active owner');
      expect(demote.out).not.toContain('Error');
      expect((await doc(`memberships/${ORG}_${uids.owner}`))?.role).toBe('owner');
      expect((await addMember('org-nope', 'owner@example.org')).out).toContain('No organization org-nope');
      expect((await addMember(ORG, 'owner@example.org', 'superuser')).code).toBe(1);
    });

    it('demotes an owner once another owner exists', async () => {
      expect((await addMember(ORG, 'family@example.org', 'owner')).code).toBe(0);
      expect((await addMember(ORG, 'owner@example.org', 'admin')).code).toBe(0);
      expect((await doc(`memberships/${ORG}_${uids.owner}`))?.role).toBe('admin');
    });
  });
});
