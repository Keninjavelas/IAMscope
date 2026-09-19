import { z } from 'zod';
import {
  accentSchema,
  densitySchema,
  emailSchema,
  nameSchema,
  objectIdSchema,
  passwordSchema,
  themeSchema,
  tokenSchema,
} from './common';

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  orgName: z.string().trim().min(2, 'Organization name is required').max(120),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(256),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  newPassword: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: tokenSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(256),
  newPassword: passwordSchema,
});

export const switchOrgSchema = z.object({
  orgId: objectIdSchema,
});

export const updatePreferencesSchema = z.object({
  density: densitySchema.optional(),
  theme: themeSchema.optional(),
  accent: accentSchema.optional(),
});

export const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
});

export const sessionIdParamSchema = z.object({ id: objectIdSchema });

export type SignupInput = z.input<typeof signupSchema>;
export type SignupOutput = z.output<typeof signupSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type LoginOutput = z.output<typeof loginSchema>;
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.input<typeof verifyEmailSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
export type SwitchOrgInput = z.input<typeof switchOrgSchema>;
export type UpdatePreferencesInput = z.input<typeof updatePreferencesSchema>;
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
