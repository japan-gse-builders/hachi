import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Identity, StaffPrincipal } from './auth.js';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
    /** Resolved once per request by `requireStaff`. */
    staff: StaffPrincipal | null;
  }
}

/** Ids the API makes or accepts in a path: letters, digits, `_` and `-`. */
export const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The organization a staff request acts for. Required once an account belongs to more than one. */
export const ORG_HEADER = 'x-hachi-org';

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function requireIdentity(req: FastifyRequest): Identity {
  if (!req.identity) throw new HttpError(401, 'Missing bearer token');
  return req.identity;
}

/** Staff must have proved they hold their email: invitations, audit entries and the team list all go by it. */
export function requireVerifiedEmail(req: FastifyRequest): Identity & { email: string } {
  const id = requireIdentity(req);
  if (!id.email || !id.emailVerified) throw new HttpError(403, 'Confirm your email address first.', 'email_unverified');
  return id as Identity & { email: string };
}
