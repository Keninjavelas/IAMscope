/**
 * Mutation hooks - one module per resource. Every hook is optimistic where the
 * entity already exists and raises an undo toast for destructive actions.
 */
export {
  useChangePassword,
  useForgotPassword,
  useLogin,
  useLogout,
  useResetPassword,
  useRevokeSession,
  useSignup,
  useSwitchOrg,
  useVerifyEmail,
} from './auth';

export {
  useAcceptInvitation,
  useCreateApiKey,
  useCreateInvitation,
  useCreateOrg,
  useDeleteOrg,
  useRemoveMember,
  useRevokeApiKey,
  useRevokeInvitation,
  useUpdateMemberRole,
  useUpdateOrg,
} from './orgs';

export { useCreatePolicy, useDeletePolicy, useRestorePolicy, useUpdatePolicy } from './policies';

export {
  useAttachPolicy,
  useCreatePrincipal,
  useDeletePrincipal,
  useDetachPolicy,
  useUpdatePrincipal,
} from './principals';
export type { UpsertPrincipalInput } from './principals';

export { useCreateResource, useDeleteResource, useUpdateResource } from './resources';
export type { UpsertResourceInput } from './resources';

export { useCreateScenario, useDeleteScenario, useUpdateScenario } from './scenarios';
export type { UpsertScenarioInput } from './scenarios';

export { useClearEvaluations, useComputeEscalation, useEvaluate } from './evaluations';

export { useHeartbeat } from './presence';
