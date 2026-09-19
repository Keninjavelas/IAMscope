/**
 * Query-string adapters.
 *
 * `api.get` takes a `Record<string, QueryValue>`. The shared query types in
 * `@iamscope/types` are *interfaces*, and TypeScript only gives implicit index
 * signatures to anonymous object types - so an interface can never be passed
 * straight through. These helpers rebuild the filter objects as literals, which
 * also guarantees we never leak `undefined` into a URL.
 */
import type { ListMembersQuery, ListQuery, ListScenariosQuery } from '@iamscope/types';
import type { QueryValue } from './client';

export type QueryParams = Record<string, QueryValue>;

export function listQueryParams(filters: ListQuery | undefined): QueryParams {
  return {
    q: filters?.q,
    tag: filters?.tag,
    includeDeleted: filters?.includeDeleted,
    page: filters?.page,
    pageSize: filters?.pageSize,
    sort: filters?.sort,
    order: filters?.order,
  };
}

export function scenarioQueryParams(filters: ListScenariosQuery | undefined): QueryParams {
  return {
    ...listQueryParams(filters),
    tags: filters?.tags,
    principalArn: filters?.principalArn,
  };
}

export function memberQueryParams(filters: ListMembersQuery | undefined): QueryParams {
  return {
    ...listQueryParams(filters),
    role: filters?.role,
    status: filters?.status,
  };
}

export interface AuditFilters {
  targetType?: string;
  targetId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  q?: string;
}

export function auditQueryParams(filters: AuditFilters | undefined): QueryParams {
  return {
    targetType: filters?.targetType,
    targetId: filters?.targetId,
    actorId: filters?.actorId,
    action: filters?.action,
    from: filters?.from,
    to: filters?.to,
    page: filters?.page,
    pageSize: filters?.pageSize,
    q: filters?.q,
  };
}

export interface EvaluationFilters {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
}

export function evaluationQueryParams(filters: EvaluationFilters | undefined): QueryParams {
  return {
    page: filters?.page,
    pageSize: filters?.pageSize,
    sort: filters?.sort,
    order: filters?.order,
    q: filters?.q,
  };
}
