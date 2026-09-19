import { z } from 'zod';
import {
  arnSchema,
  changeReasonSchema,
  conditionOperatorSchema,
  iamActionSchema,
  listQuerySchema,
  policyEffectSchema,
  tagsSchema,
} from './common';

export const policyConditionSchema = z.object({
  operator: conditionOperatorSchema,
  key: z
    .string()
    .trim()
    .min(1, 'Condition key is required')
    .max(128)
    .regex(/^[A-Za-z0-9$._\-/:*]+$/, 'Condition keys are like aws:PrincipalArn or s3:prefix'),
  values: z.array(z.string().trim().min(0).max(512)).min(1, 'Provide at least one value').max(64),
});

export const policyStatementSchema = z.object({
  sid: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9]*$/, 'Sid must be alphanumeric')
    .default(''),
  effect: policyEffectSchema,
  actions: z
    .array(iamActionSchema)
    .min(1, 'At least one action is required')
    .max(256, 'A statement supports at most 256 actions'),
  resources: z
    .array(z.union([arnSchema, z.literal('*')]))
    .min(1, 'At least one resource is required')
    .max(256, 'A statement supports at most 256 resources'),
  conditions: z.array(policyConditionSchema).max(64).default([]),
});

const statementsSchema = z
  .array(policyStatementSchema)
  .min(1, 'A policy needs at least one statement')
  .max(512, 'A policy supports at most 512 statements')
  .superRefine((statements, ctx) => {
    const seen = new Set<string>();
    statements.forEach((statement, index) => {
      if (statement.sid === '') return;
      const key = statement.sid.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'sid'],
          message: `Duplicate Sid "${statement.sid}" - Sids must be unique inside a policy`,
        });
      }
      seen.add(key);
    });
  });

export const createPolicySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  statements: statementsSchema,
  tags: tagsSchema.optional(),
  changeReason: changeReasonSchema,
  arn: arnSchema.optional(),
});

export const updatePolicySchema = z.object({
  statements: statementsSchema,
  tags: tagsSchema.optional(),
  changeReason: changeReasonSchema,
});

export const restorePolicySchema = z.object({
  version: z.coerce.number().int().min(1, 'Version must be >= 1'),
  changeReason: changeReasonSchema.optional(),
});

export const listPoliciesQuerySchema = listQuerySchema;

export type PolicyConditionInput = z.input<typeof policyConditionSchema>;
export type PolicyStatementInput = z.input<typeof policyStatementSchema>;
export type PolicyStatementOutput = z.output<typeof policyStatementSchema>;
export type CreatePolicyInput = z.input<typeof createPolicySchema>;
export type CreatePolicyOutput = z.output<typeof createPolicySchema>;
export type UpdatePolicyInput = z.input<typeof updatePolicySchema>;
export type UpdatePolicyOutput = z.output<typeof updatePolicySchema>;
export type RestorePolicyInput = z.input<typeof restorePolicySchema>;
