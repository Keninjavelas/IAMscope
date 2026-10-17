/**
 * Transport-level wire types: response envelope, pagination, error codes.
 */

export interface ApiErrorBody {
  code: ApiErrorCode | (string & {});
  message: string;
  details?: unknown;
  requestId?: string;
}

/** Standard envelope for every endpoint (Plan §8). */
export interface ApiResponse<T> {
  data: T | null;
  error?: ApiErrorBody;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CSRF_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  /** Client-side: the request exceeded the request timeout. */
  | 'NETWORK_TIMEOUT';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PaginatedQuery {
  page?: number;
  pageSize?: number;
}

/** `GET /api/health` */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  database: {
    identity: 'up' | 'down';
    data: 'up' | 'down';
  };
  watchers: {
    active: boolean;
    watchedCollections: string[];
  };
  sseClients: number;
  timestamp: string;
}

export interface SortQuery {
  sort?: string;
  order?: 'asc' | 'desc';
}
