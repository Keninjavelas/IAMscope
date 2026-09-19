import { z } from 'zod';
import {
  accentSchema,
  apiKeyScopeSchema,
  assignableRoleSchema,
  densitySchema,
  emailSchema,
  isoDateTimeSchema,
  listQuerySchema,
  nameSchema,
  objectIdSchema,
  roleSchema,
  slugSchema,
  themeSchema,
} from './common';

export const createOrgSchema = z.object({
  name: z.string().trim().min(2, 'Organization name is required').max(120),
  slug: slugSchema.optional(),
});

export const updateOrgSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    settings: z
      .object({
        defaultDensity: densitySchema.optional(),
        defaultTheme: themeSchema.optional(),
        accent: accentSchema.optional(),
      })
      .optional(),
  })
  .refine((value) => value.name !== undefined || value.settings !== undefined, {
    message: 'Nothing to update',
  });

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: assignableRoleSchema,
});

export const updateMemberRoleSchema = z.object({
  role: roleSchema,
});

export const acceptInvitationSchema = z.object({
  name: nameSchema,
  password: z.string().min(12, 'Password must be at least 12 characters').max(256),
});

export const invitationTokenParamSchema = z.object({ token: z.string().trim().min(16).max(512) });

export const listMembersQuerySchema = listQuerySchema.extend({
  role: roleSchema.optional(),
  status: z.enum(['active', 'invited', 'removed']).optional(),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  scopes: z.array(apiKeyScopeSchema).min(1, 'Pick at least one scope').max(4),
  expiresAt: isoDateTimeSchema.nullable().optional(),
});

export const orgIdAndApiKeyIdParamSchema = z.object({
  orgId: objectIdSchema,
  id: objectIdSchema,
});

export const invitationIdParamSchema = z.object({
  orgId: objectIdSchema,
  id: objectIdSchema,
});

export type CreateOrgInput = z.input<typeof createOrgSchema>;
export type UpdateOrgInput = z.input<typeof updateOrgSchema>;
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;
export type UpdateMemberRoleInput = z.input<typeof updateMemberRoleSchema>;
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;
export type CreateApiKeyInput = z.input<typeof createApiKeySchema>;
