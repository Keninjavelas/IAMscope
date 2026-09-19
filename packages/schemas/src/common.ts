import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId');

export const isoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO-8601 date-time string');

export const nonEmptyStringSchema = z.string().trim().min(1).max(200);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')
  .min(3, 'Slug must be at least 3 characters')
  .max(48, 'Slug must be at most 48 characters');

export const tagsSchema = z.record(z.string().trim().min(1).max(64), z.string().trim().max(256));

export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

/* ------------------------------------------------------------------ */
/* AWS-ish identifiers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Permissive ARN: accepts wildcards and `?` so it can describe resource *patterns*.
 * `arn:partition:service:region:account:resource`
 */
export const arnSchema = z
  .string()
  .trim()
  .min(6)
  .max(2048)
  .refine(
    (value) =>
      /^arn:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]*:(\d{0,12}|\*):[^\s:]+(\/[^\s]*)*$/.test(value),
    'Expected an ARN of the form arn:aws:service:region:account:resource',
  );

/** ARNs acting as identity: no wildcards allowed. */
export const principalArnSchema = z
  .string()
  .trim()
  .min(6)
  .max(512)
  .refine(
    (value) => !value.includes('*') && !value.includes('?'),
    'Principal ARNs cannot contain wildcards',
  )
  .refine(
    (value) =>
      /^arn:[a-z0-9-]+:(iam|sts)::\d{12}:(user|role|group|root)\/[^\s]+$/.test(value) ||
      /^arn:[a-z0-9-]+:(iam|sts)::\d{12}:(root|user\/[^\s]+|role\/[^\s]+|group\/[^\s]+)$/.test(
        value,
      ),
    'Expected an IAM principal ARN (user/, role/ or group/)',
  );

/** IAM action: `s3:GetObject`, `s3:*`, `s3:Get*`, or `*`. */
export const iamActionSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (value) => value === '*' || /^[a-z0-9-]+:[A-Za-z0-9*?]+$/.test(value),
    'Expected an action like s3:GetObject, s3:* or *',
  );

export const resourceTypeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Resource types are lowercase, e.g. s3-bucket');

/* ------------------------------------------------------------------ */
/* Pagination / sorting                                                */
/* ------------------------------------------------------------------ */

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const sortSchema = z.object({
  sort: z.string().trim().max(64).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const listQuerySchema = paginationSchema.merge(sortSchema).extend({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(200).optional(),
  includeDeleted: booleanQuerySchema.optional(),
});

export type ListQueryInput = z.input<typeof listQuerySchema>;
export type ListQueryOutput = z.output<typeof listQuerySchema>;

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

export const idParamSchema = z.object({ id: objectIdSchema });
export const idAndVersionParamSchema = z.object({
  id: objectIdSchema,
  v: z.coerce.number().int().min(1),
});
export const orgIdParamSchema = z.object({ orgId: objectIdSchema });
export const orgAndUserIdParamSchema = z.object({
  orgId: objectIdSchema,
  userId: objectIdSchema,
});
export const principalPolicyParamSchema = z.object({
  id: objectIdSchema,
  policyId: objectIdSchema,
});

/* ------------------------------------------------------------------ */
/* Email + password                                                    */
/* ------------------------------------------------------------------ */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address');

/**
 * Small embedded deny-list. Plan §19 requires a `min 12 chars` password checked
 * against "a small common-password list" - this is that list. Kept short on purpose
 * so it stays cheap to evaluate per request; a production deployment would swap in
 * a full breached-password corpus.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  'password1234',
  'password12345',
  'passwordpassword',
  '123456789012',
  '1234567890123',
  'qwertyuiop123',
  'qwertyuiopasd',
  'letmeinletmein',
  'iloveyouiloveyou',
  'adminadmin123',
  'administrator1',
  'welcomewelcome',
  'changemechangeme',
  'trustno1trustno1',
  'iamscope12345',
  'correcthorsebatterystaple',
];

export function isCommonPassword(value: string): boolean {
  const normalised = value.toLowerCase();
  if (COMMON_PASSWORDS.includes(normalised)) return true;
  // Collapse trivial repetition/sequences: "aaaaaaaaaaaa", "abcdefghijkl", "123456789012".
  if (/^(.)\1{11,}$/.test(normalised)) return true;
  if (/^(?:0123456789|1234567890|abcdefghij|qwertyuiop)+/.test(normalised)) return true;
  return false;
}

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256, 'Password must be at most 256 characters')
  .refine((value) => !isCommonPassword(value), 'Choose a less predictable password');

export const tokenSchema = z
  .string()
  .trim()
  .min(16, 'Invalid token')
  .max(512, 'Invalid token')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid token');

/* ------------------------------------------------------------------ */
/* Naming / display                                                    */
/* ------------------------------------------------------------------ */

export const nameSchema = z.string().trim().min(1, 'Name is required').max(120);
export const shortNameSchema = z.string().trim().min(1).max(200);
export const labelSchema = z.string().trim().min(1).max(200);
export const changeReasonSchema = z.string().trim().min(3).max(500);
export const accentSchema = z.enum(['blue', 'violet', 'teal', 'amber', 'rose', 'green']);

export const densitySchema = z.enum(['compact', 'comfortable', 'spacious']);
export const themeSchema = z.enum(['dark', 'light', 'system']);
export const roleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const assignableRoleSchema = z.enum(['admin', 'member', 'viewer']);
export const principalTypeSchema = z.enum(['User', 'Role', 'Group']);
export const policyEffectSchema = z.enum(['Allow', 'Deny']);

export const conditionOperatorSchema = z.enum([
  'StringEquals',
  'StringLike',
  'ArnLike',
  'StringNotEquals',
  'ArnEquals',
  'Bool',
  'IpAddress',
  'NotIpAddress',
]);

export const apiKeyScopeSchema = z.enum(['read', 'write', 'evaluate', 'admin']);
