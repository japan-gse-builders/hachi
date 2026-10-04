import { isValidTimeZone, URGENCIES } from '@hachi/core';
import { z } from 'zod';

const e164 = z
  .string()
  // Accepts full-width input and Japanese domestic numbers (090...), as typed on Japanese keyboards.
  .transform((s) => s.normalize('NFKC').replace(/[\s\-().]/g, '').replace(/^0(?=[1-9]\d{8,9}$)/, '+81'))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone number must include the country code, e.g. +81 90 1234 5678'));
const email = z.string().trim().toLowerCase().pipe(z.email());
const shortText = (max: number) => z.string().trim().min(1).max(max);

const hasSmsOrEmail = (c: { sms?: string | undefined; email?: string | undefined }) => Boolean(c.sms || c.email);

export const staffContactSchema = z
  .object({
    name: shortText(100),
    phone: e164,
    sms: e164.optional(),
    email: email.optional(),
  })
  .refine(hasSmsOrEmail, { message: 'Staff needs an SMS number or an email address', path: ['sms'] });

export const familyContactSchema = z
  .object({
    name: shortText(100),
    relationship: shortText(50).optional(),
    sms: e164.optional(),
    email: email.optional(),
  })
  .refine(hasSmsOrEmail, { message: 'Family needs an SMS number or an email address', path: ['sms'] });

export const vulnerabilitySchema = z.object({
  livesAlone: z.boolean(),
  hasCloseSupporter: z.boolean(),
  needsCare: z.boolean(),
  chronicConditions: z.array(shortText(100)).max(20).default([]),
});

const residentFields = {
  name: shortText(100),
  preferredName: shortText(50),
  phone: e164,
  channel: z.enum(['pstn', 'whatsapp']),
  callTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 10:00'),
  timeZone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
  vulnerability: vulnerabilitySchema,
  householdNotes: z.string().trim().max(1000),
  staff: staffContactSchema,
};

/** USR-01, USR-02, USR-03 */
export const residentInputSchema = z.object({
  ...residentFields,
  channel: residentFields.channel.default('pstn'),
  householdNotes: residentFields.householdNotes.optional(),
  family: familyContactSchema.optional(),
  serviceStartedAt: z.iso.datetime().optional(),
});
export type ResidentInput = z.infer<typeof residentInputSchema>;

export const residentPatchSchema = z
  .object(residentFields)
  .partial()
  .extend({ family: familyContactSchema.nullable().optional(), active: z.boolean().optional() });
export type ResidentPatch = z.infer<typeof residentPatchSchema>;

const turnSchema = z
  .object({
    speaker: z.enum(['resident', 'agent']),
    text: z.string().max(5000),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .refine((t) => t.endMs >= t.startMs, { message: 'endMs must be >= startMs', path: ['endMs'] });

/** USR-04: historical calls for demos and baseline building. */
export const callImportSchema = z.object({
  calls: z
    .array(
      z
        .object({
          startedAt: z.iso.datetime(),
          endedAt: z.iso.datetime(),
          transcript: z.array(turnSchema).min(1).max(2000),
        })
        .refine((c) => c.endedAt >= c.startedAt, { message: 'endedAt must be after startedAt', path: ['endedAt'] }),
    )
    .min(1)
    .max(200),
});
export type CallImport = z.infer<typeof callImportSchema>;

/** QUE-03 */
export const caseUpdateSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'closed']).optional(),
    urgency: z.enum(URGENCIES).optional(),
    scoreOffset: z.number().min(-10).max(10).optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    outcome: z.object({ anomalyConfirmed: z.boolean(), note: z.string().trim().max(1000).optional() }).optional(),
  })
  .refine((u) => u.status || u.urgency || u.scoreOffset !== undefined, { message: 'Nothing to update' })
  .refine((u) => (u.urgency === undefined && u.scoreOffset === undefined) || u.reason, {
    message: 'A reason is required when changing urgency or rank',
    path: ['reason'],
  })
  .refine((u) => u.status !== 'closed' || u.outcome, {
    message: 'Closing a case requires whether there actually was an anomaly',
    path: ['outcome'],
  });
export type CaseUpdate = z.infer<typeof caseUpdateSchema>;

export const pushTokenSchema = z.object({ token: z.string().min(10).max(4096) });
