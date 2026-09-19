/** Small ARN helpers shared by the evaluator, escalation engine and seed script. */

export interface ParsedArn {
  partition: string;
  service: string;
  region: string;
  accountId: string;
  resource: string;
}

export function parseArn(arn: string): ParsedArn | null {
  const parts = arn.split(':');
  if (parts.length < 6) return null;
  const [prefix, partition, service, region, accountId, ...rest] = parts;
  if (prefix !== 'arn' || partition === undefined || service === undefined) return null;
  return {
    partition,
    service,
    region: region ?? '',
    accountId: accountId ?? '',
    resource: rest.join(':'),
  };
}

export function arnService(arn: string): string | null {
  return parseArn(arn)?.service ?? null;
}

export function arnAccountId(arn: string): string | null {
  const accountId = parseArn(arn)?.accountId;
  return accountId !== undefined && accountId !== '' ? accountId : null;
}

/** The trailing path segment of an ARN - `arn:...:role/Admin` -> `Admin`. */
export function principalNameFromArn(arn: string): string {
  const resource = parseArn(arn)?.resource ?? arn;
  const segment = resource.split('/').pop();
  return segment !== undefined && segment !== '' ? segment : arn;
}

export function buildPolicyArn(accountId: string, policyName: string): string {
  const safeName = policyName.trim().replace(/\s+/g, '-');
  return `arn:aws:iam::${accountId}:policy/${safeName}`;
}

export function buildRoleArn(accountId: string, roleName: string): string {
  return `arn:aws:iam::${accountId}:role/${roleName}`;
}

export function buildUserArn(accountId: string, userName: string): string {
  return `arn:aws:iam::${accountId}:user/${userName}`;
}

/** `true` when the value looks like an ARN at all (wildcards permitted). */
export function isArnLike(value: string): boolean {
  return value.startsWith('arn:') && value.split(':').length >= 6;
}

/** The `service` portion used by the escalation graph edges. */
export function arnResourceType(arn: string): string {
  const resource = parseArn(arn)?.resource ?? '';
  const [type] = resource.split('/');
  return type ?? '';
}
