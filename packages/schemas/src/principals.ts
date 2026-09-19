import { z } from 'zod';
import {
  arnSchema,
  listQuerySchema,
  objectIdSchema,
  principalArnSchema,
  principalTypeSchema,
  tagsSchema,
} from './common';

export const createPrincipalSchema = z
  .object({
    type: principalTypeSchema,
    name: z.string().trim().min(1, 'Name is required').max(160),
    arn: principalArnSchema,
    attachedPolicies: z.array(objectIdSchema).max(128).optional(),
    groupMemberships: z.array(principalArnSchema).max(128).optional(),
    assumeRoleTargets: z.array(principalArnSchema).max(256).optional(),
    boundaryPolicyId: objectIdSchema.nullable().optional(),
    tags: tagsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type !== 'User' && (value.groupMemberships?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupMemberships'],
        message: 'Only principals of type "User" can belong to groups',
      });
    }
    if (value.type === 'Group' && value.assumeRoleTargets?.includes(value.arn) === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assumeRoleTargets'],
        message: 'A principal cannot assume itself',
      });
    }
  });

export const updatePrincipalSchema = z
  .object({
    type: principalTypeSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    arn: principalArnSchema.optional(),
    attachedPolicies: z.array(objectIdSchema).max(128).optional(),
    groupMemberships: z.array(principalArnSchema).max(128).optional(),
    assumeRoleTargets: z.array(principalArnSchema).max(256).optional(),
    boundaryPolicyId: objectIdSchema.nullable().optional(),
    tags: tagsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Nothing to update',
  });

export const listPrincipalsQuerySchema = listQuerySchema.extend({
  type: principalTypeSchema.optional(),
  arn: arnSchema.optional(),
});

export type CreatePrincipalInput = z.input<typeof createPrincipalSchema>;
export type CreatePrincipalOutput = z.output<typeof createPrincipalSchema>;
export type UpdatePrincipalInput = z.input<typeof updatePrincipalSchema>;
