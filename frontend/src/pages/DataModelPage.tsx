import type { JSX } from 'react';
import { Database, GitBranch, History, KeyRound, Lock, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { ROUTES } from '@/lib/constants';

interface CollectionDoc {
  name: string;
  purpose: string;
  fields: string;
  indexes: string;
}

const IDENTITY: CollectionDoc[] = [
  {
    name: 'users',
    purpose: 'One document per human account.',
    fields: 'email, name, passwordHash, emailVerified, mfaEnabled, preferences, lastLoginAt',
    indexes: 'unique email (case-insensitive)',
  },
  {
    name: 'sessions',
    purpose: 'Server-side sessions, so revocation is immediate.',
    fields: 'userId, activeOrgId, userAgent, ip, expiresAt, revokedAt',
    indexes: 'userId + revokedAt; TTL on expiresAt',
  },
  {
    name: 'organizations',
    purpose: 'The tenant boundary. Everything else is scoped to one.',
    fields: 'name, slug, plan, settings (defaultDensity/defaultTheme/accent), createdBy',
    indexes: 'unique slug',
  },
  {
    name: 'memberships',
    purpose: 'The join between a user and an organization, carrying the role.',
    fields: 'orgId, userId, role, status, invitedBy, joinedAt',
    indexes: 'unique orgId + userId; orgId + role',
  },
  {
    name: 'invitations',
    purpose: 'Pending invites, stored hashed so a leaked database cannot be replayed.',
    fields: 'orgId, email, role, tokenHash, expiresAt, acceptedAt',
    indexes: 'unique tokenHash; orgId + email',
  },
  {
    name: 'api_keys',
    purpose: 'Machine credentials with an explicit scope list.',
    fields: 'orgId, name, prefix, keyHash, scopes, lastUsedAt, expiresAt, revokedAt',
    indexes: 'unique prefix; orgId + revokedAt',
  },
];

const DOMAIN: CollectionDoc[] = [
  {
    name: 'policies',
    purpose: 'The current shape of a policy. Statements live inline so a read is one document.',
    fields: 'orgId, name, arn, currentVersion, statements[], tags, deleted, createdBy, updatedBy',
    indexes: 'unique orgId + arn; orgId + deleted; orgId + tags',
  },
  {
    name: 'policy_versions',
    purpose: 'Immutable history. Written on every save, never updated.',
    fields: 'orgId, policyId, version, statements[], changedBy, changeReason, createdAt',
    indexes: 'unique policyId + version; orgId + createdAt',
  },
  {
    name: 'principals',
    purpose: 'Users, roles and groups, with the edges the graph lens walks.',
    fields:
      'orgId, type, name, arn, attachedPolicies[], groupMemberships[], assumeRoleTargets[], boundaryPolicyId, tags',
    indexes: 'unique orgId + arn; orgId + type; orgId + attachedPolicies',
  },
  {
    name: 'resources',
    purpose: 'The ARNs policies may target.',
    fields: 'orgId, arn, type, tags, accountId, deleted',
    indexes: 'unique orgId + arn; orgId + type',
  },
  {
    name: 'scenarios',
    purpose: 'Saved access questions plus the expected answer.',
    fields: 'orgId, name, principalArn, action, resourceArn, expectedResult, tags',
    indexes: 'orgId + tags; orgId + principalArn',
  },
  {
    name: 'evaluation_runs / evaluation_results',
    purpose:
      'A run is the batch; each result is one scenario decision with its matched statements.',
    fields: 'runId, orgId, label, startedAt, outcome, result, matchedStatements[], reason',
    indexes: 'orgId + startedAt; runId + scenarioId',
  },
  {
    name: 'audit_events',
    purpose: 'Who changed what, with the before/after delta, and which run it triggered.',
    fields: 'orgId, actorId, action, targetType, targetId, before, after, requestId, timestamp',
    indexes: 'orgId + timestamp; orgId + targetType + targetId; orgId + actorId',
  },
  {
    name: 'presence',
    purpose: 'Ephemeral liveness: where each user is, with a TTL so a closed tab vanishes.',
    fields: 'orgId, userId, location, entityType, entityId, cursor, lastSeenAt',
    indexes: 'TTL on lastSeenAt; unique orgId + userId',
  },
];

const RULES = [
  {
    icon: Lock,
    title: 'Everything is tenant-scoped',
    body: 'Every domain document carries orgId, and every query filters on the caller’s active membership. There is no cross-tenant read path.',
  },
  {
    icon: History,
    title: 'Writes are versioned, not overwritten',
    body: 'A policy save appends a policy_versions row inside the same write, so history cannot drift from the current document.',
  },
  {
    icon: GitBranch,
    title: 'Deletes are soft, then audited',
    body: 'Policies, principals and resources flip a deleted flag and stay queryable via includeDeleted, which the list filters expose.',
  },
  {
    icon: ShieldCheck,
    title: 'Derived data is disposable',
    body: 'Evaluation results, escalation paths and timeline snapshots are caches. Deleting them loses speed, never truth.',
  },
];

function CollectionTable({ docs }: { docs: CollectionDoc[] }): JSX.Element {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full border-collapse text-13">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 text-left text-12 font-medium text-text-muted">
              Collection
            </th>
            <th scope="col" className="px-3 py-2 text-left text-12 font-medium text-text-muted">
              Purpose
            </th>
            <th scope="col" className="px-3 py-2 text-left text-12 font-medium text-text-muted">
              Key fields
            </th>
            <th scope="col" className="px-3 py-2 text-left text-12 font-medium text-text-muted">
              Indexes
            </th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.name} className="border-b border-border-subtle last:border-b-0">
              <th
                scope="row"
                className="mono px-3 py-2 text-left align-top text-13 font-medium text-text"
              >
                {doc.name}
              </th>
              <td className="max-w-[280px] px-3 py-2 align-top text-text-muted">{doc.purpose}</td>
              <td className="mono max-w-[320px] px-3 py-2 align-top text-12 break-words text-text-subtle">
                {doc.fields}
              </td>
              <td className="mono max-w-[260px] px-3 py-2 align-top text-12 break-words text-text-subtle">
                {doc.indexes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataModelPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Data model"
        description="Two databases, one tenant boundary. Identity is read constantly; the domain model and its derived analysis live separately."
        breadcrumbs={[{ label: 'Reference' }, { label: 'Data model' }]}
        actions={
          <Badge variant="muted" icon={Database}>
            2 databases
          </Badge>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2">
        <article className="panel flex items-start gap-3 p-4">
          <Database aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="flex flex-col gap-1">
            <h2 className="mono text-14 font-semibold text-text">iamscope_identity</h2>
            <p className="text-13 text-text-muted">
              Accounts, sessions and the tenant structure. Read on nearly every request.
            </p>
          </div>
        </article>
        <article className="panel flex items-start gap-3 p-4">
          <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="flex flex-col gap-1">
            <h2 className="mono text-14 font-semibold text-text">iamscope_data</h2>
            <p className="text-13 text-text-muted">
              Policies, principals, resources, scenarios, plus evaluation, audit and presence data
              derived from them.
            </p>
          </div>
        </article>
      </section>

      <section aria-labelledby="identity-heading" className="flex flex-col gap-3">
        <h2
          id="identity-heading"
          className="text-16 flex items-center gap-2 font-semibold tracking-tight text-text"
        >
          <KeyRound aria-hidden="true" className="size-4 text-text-muted" />
          Identity collections
        </h2>
        <CollectionTable docs={IDENTITY} />
      </section>

      <section aria-labelledby="domain-heading" className="flex flex-col gap-3">
        <h2
          id="domain-heading"
          className="text-16 flex items-center gap-2 font-semibold tracking-tight text-text"
        >
          <ShieldCheck aria-hidden="true" className="size-4 text-text-muted" />
          Domain and analysis collections
        </h2>
        <CollectionTable docs={DOMAIN} />
      </section>

      <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
        <h2 id="rules-heading" className="text-16 font-semibold tracking-tight text-text">
          Rules the model relies on
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {RULES.map((rule) => (
            <article key={rule.title} className="panel flex gap-3 p-4">
              <rule.icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="flex flex-col gap-1">
                <h3 className="text-13 font-semibold text-text">{rule.title}</h3>
                <p className="text-meta text-text-muted">{rule.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="text-13 text-text-muted">
        Want to see it in motion? The{' '}
        <Link to={ROUTES.timeline} className="font-medium">
          Timeline
        </Link>{' '}
        lens reconstructs this model at any past minute, and the{' '}
        <Link to={ROUTES.audit} className="font-medium">
          Audit
        </Link>{' '}
        lens lists every write that moved it.
      </p>
    </div>
  );
}
