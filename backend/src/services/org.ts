/**
 * Org-scoped helpers (Plan §6 `services/org.ts`, §9.5, §9.6): slug uniqueness, membership
 * lookups, role checks and DTO assembly.
 */
import { ObjectId } from 'mongodb';
import { DEFAULT_ORG_SETTINGS, type Org, type Paginated, type Role } from '@iamscope/types';
import { identity } from '../db/identity';
import type { MembershipDoc, OrgDoc, UserDoc } from '../db/documents';
import { roleAtLeast } from '../auth/context';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { resolvePagination, paginated } from '../lib/pagination';
import { toMembershipDTO, toOrgDTO, toPublicUserSummary } from '../lib/serialize';
import { uniqueSlug } from '../lib/slug';

export async function slugExists(slug: string): Promise<boolean> {
  const existing = await identity.orgs().findOne({ slug }, { projection: { _id: 1 } });
  return existing !== null;
}

export async function generateOrgSlug(name: string, preferred?: string): Promise<string> {
  return uniqueSlug(preferred ?? name, slugExists);
}

export interface CreateOrgInput {
  name: string;
  slug?: string;
  createdBy: ObjectId;
  now?: Date;
}

export async function createOrg(input: CreateOrgInput): Promise<OrgDoc> {
  const now = input.now ?? new Date();
  const slug = await generateOrgSlug(input.name, input.slug);

  const doc: Omit<OrgDoc, '_id'> = {
    name: input.name.trim(),
    slug,
    plan: 'free',
    createdBy: input.createdBy,
    settings: { ...DEFAULT_ORG_SETTINGS },
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const result = await identity.orgs().insertOne(doc as OrgDoc);
  return { ...doc, _id: result.insertedId };
}

export async function findOrg(orgId: ObjectId | string): Promise<OrgDoc | null> {
  const id = typeof orgId === 'string' ? new ObjectId(orgId) : orgId;
  return identity.orgs().findOne({ _id: id, deletedAt: null });
}

export async function getOrgOrThrow(orgId: ObjectId | string): Promise<OrgDoc> {
  const org = await findOrg(orgId);
  if (org === null) throw notFound('Organization not found');
  return org;
}

export async function findActiveMembership(
  orgId: ObjectId,
  userId: ObjectId,
): Promise<MembershipDoc | null> {
  return identity.memberships().findOne({ orgId, userId, status: 'active' });
}

/** Idempotently ensures a membership row exists with at least `role`. */
export async function ensureMembership(
  orgId: ObjectId,
  userId: ObjectId,
  role: Role,
  invitedBy: ObjectId | null = null,
  status: 'active' | 'invited' = 'active',
): Promise<MembershipDoc> {
  const existing = await identity.memberships().findOne({ orgId, userId });
  const now = new Date();

  if (existing !== null) {
    if (existing.status === status && existing.role === role) return existing;
    await identity.memberships().updateOne({ _id: existing._id }, { $set: { role, status } });
    return { ...existing, role, status };
  }

  const doc: Omit<MembershipDoc, '_id'> = {
    orgId,
    userId,
    role,
    invitedBy,
    joinedAt: now,
    status,
  };
  const result = await identity.memberships().insertOne(doc as MembershipDoc);
  return { ...doc, _id: result.insertedId };
}

/** Throws 403 unless the user has at least `minimum` in the org. */
export async function assertRole(
  orgId: ObjectId,
  userId: ObjectId,
  minimum: Role,
): Promise<MembershipDoc> {
  const membership = await findActiveMembership(orgId, userId);
  if (membership === null) throw forbidden('You are not a member of this organization');
  if (!roleAtLeast(membership.role, minimum))
    throw forbidden(`This action requires the ${minimum} role`);
  return membership;
}

export interface OrgWithRole {
  org: OrgDoc;
  role: Role;
}

export async function listOrgsForUser(userId: ObjectId): Promise<OrgWithRole[]> {
  const memberships = await identity
    .memberships()
    .find({ userId, status: 'active' })
    .sort({ joinedAt: 1 })
    .toArray();

  if (memberships.length === 0) return [];

  const orgIds = memberships.map((membership) => membership.orgId);
  const orgs = await identity
    .orgs()
    .find({ _id: { $in: orgIds }, deletedAt: null })
    .toArray();
  const byId = new Map(orgs.map((org) => [oidRequired(org._id), org]));

  const result: OrgWithRole[] = [];
  for (const membership of memberships) {
    const org = byId.get(oidRequired(membership.orgId));
    if (org !== undefined) result.push({ org, role: membership.role });
  }
  return result;
}

export async function countActiveMembers(orgId: ObjectId): Promise<number> {
  return identity.memberships().countDocuments({ orgId, status: 'active' });
}

/** Builds the `Org` DTO with the caller's role and a member count. */
export async function toOrgDTOForUser(
  org: OrgDoc,
  role: Role | null,
  withMemberCount = true,
): Promise<Org> {
  const memberCount = withMemberCount ? await countActiveMembers(org._id) : undefined;
  return toOrgDTO(org, {
    ...(role === null ? {} : { role }),
    ...(memberCount === undefined ? {} : { memberCount }),
  });
}

export interface ListMembersQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  q?: string | undefined;
  role?: Role | undefined;
  status?: 'active' | 'invited' | 'removed' | undefined;
}

export async function listOrgMembers(
  orgId: ObjectId,
  query: ListMembersQuery,
): Promise<Paginated<ReturnType<typeof toMembershipDTO>>> {
  const args = resolvePagination(query);
  const filter: Record<string, unknown> = { orgId };
  if (query.role !== undefined) filter.role = query.role;
  if (query.status !== undefined) filter.status = query.status;

  const collection = identity.memberships();
  const total = await collection.countDocuments(filter);
  const memberships = await collection
    .find(filter)
    .sort({ joinedAt: 1 })
    .skip(args.skip)
    .limit(args.limit)
    .toArray();

  const userIds = memberships.map((membership) => membership.userId);
  const users =
    userIds.length === 0
      ? []
      : await identity
          .users()
          .find({ _id: { $in: userIds } })
          .toArray();
  const byId = new Map(users.map((user: UserDoc) => [oidRequired(user._id), user]));

  let items = memberships.map((membership) => {
    const user = byId.get(oidRequired(membership.userId));
    return toMembershipDTO(membership, user === undefined ? null : toPublicUserSummary(user));
  });

  if (query.q !== undefined && query.q.trim() !== '') {
    const needle = query.q.trim().toLowerCase();
    items = items.filter((item) => {
      const name = item.user?.name.toLowerCase() ?? '';
      const email = item.user?.email.toLowerCase() ?? '';
      return name.includes(needle) || email.includes(needle);
    });
  }

  return paginated(items, total, args);
}

/** Guards against a member being removed from (or demoted out of) the last owner seat. */
export async function assertNotLastOwner(orgId: ObjectId, userId: ObjectId): Promise<void> {
  const membership = await findActiveMembership(orgId, userId);
  if (membership?.role !== 'owner') return;

  const owners = await identity
    .memberships()
    .countDocuments({ orgId, role: 'owner', status: 'active' });
  if (owners <= 1) throw conflict('An organization must keep at least one owner');
}

export function isOwnerOf(org: OrgDoc, userId: ObjectId): boolean {
  return oidRequired(org.createdBy) === oidRequired(userId);
}

export function membershipOrThrow(membership: MembershipDoc | null): MembershipDoc {
  if (membership === null)
    throw new AppError('FORBIDDEN', 'You are not a member of this organization');
  return membership;
}
