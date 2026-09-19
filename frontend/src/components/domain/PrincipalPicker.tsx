import type { JSX } from 'react';
import type { Principal, PrincipalType } from '@iamscope/types';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Combobox, type ComboboxItem } from '@/components/ui/Combobox';
import { HoverPreview } from '@/components/ui/Popover';
import { arnParts, truncateArn } from '@/lib/format';

const TYPE_VARIANT: Record<PrincipalType, BadgeVariant> = {
  User: 'info',
  Role: 'accent',
  Group: 'muted',
};

export interface PrincipalPickerProps {
  value: string | null;
  onChange: (arn: string | null) => void;
  principals: readonly Principal[];
  label?: string | undefined;
  error?: string | null | undefined;
  allowCreate?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/** Hover-to-preview body: everything the picker row cannot fit. */
function PrincipalPreview({ principal }: { principal: Principal }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-13 font-medium text-text">{principal.name}</p>
      <p className="mono text-micro break-all text-text-muted">{principal.arn}</p>
      <dl className="text-micro grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-text-subtle">
        <dt>Type</dt>
        <dd className="text-text-muted">{principal.type}</dd>
        <dt>Policies</dt>
        <dd className="text-text-muted">{principal.attachedPolicies.length} attached</dd>
        <dt>Groups</dt>
        <dd className="text-text-muted">{principal.groupMemberships.length} memberships</dd>
        <dt>Assume</dt>
        <dd className="text-text-muted">{principal.assumeRoleTargets.length} targets</dd>
      </dl>
      {Object.keys(principal.tags).length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {Object.entries(principal.tags).map(([key, tagValue]) => (
            <Badge key={key} variant="outline" hideIcon>
              {key}={tagValue}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ARN picker for principals. Rows show a type badge plus the truncated ARN and
 * expose the full ARN through a keyboard-reachable hover preview.
 */
export function PrincipalPicker({
  value,
  onChange,
  principals,
  label = 'Principal',
  error = null,
  disabled = false,
  className,
}: PrincipalPickerProps): JSX.Element {
  const items: ComboboxItem[] = principals.map((principal) => ({
    value: principal.arn,
    label: principal.name,
    description: truncateArn(principal.arn),
    group: principal.type,
    keywords: [principal.arn, principal.type, ...Object.values(principal.tags)],
    disabled: principal.deleted,
    meta: (
      <Badge variant={TYPE_VARIANT[principal.type]} hideIcon>
        {principal.type}
      </Badge>
    ),
  }));

  const selected = principals.find((principal) => principal.arn === value) ?? null;

  return (
    <div className={className}>
      <Combobox
        value={value}
        onChange={onChange}
        items={items}
        label={label}
        error={error}
        disabled={disabled}
        allowClear
        placeholder="Select a principal…"
        searchPlaceholder="Search by name, ARN or tag…"
        emptyMessage={
          principals.length === 0
            ? 'No principals in this organization yet. Create one first.'
            : 'No principal matches that search.'
        }
      />

      {selected ? (
        <div className="mt-1 flex items-center gap-2">
          <HoverPreview content={<PrincipalPreview principal={selected} />}>
            <span className="mono text-micro truncate text-text-subtle" title={selected.arn}>
              {arnParts(selected.arn).service}:{arnParts(selected.arn).resourceName}
            </span>
          </HoverPreview>
        </div>
      ) : null}
    </div>
  );
}
