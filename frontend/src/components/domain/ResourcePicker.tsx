import type { JSX } from 'react';
import type { Resource } from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { Combobox, type ComboboxItem } from '@/components/ui/Combobox';
import { HoverPreview } from '@/components/ui/Popover';
import { arnParts, truncateArn } from '@/lib/format';

export interface ResourcePickerProps {
  value: string | null;
  onChange: (arn: string | null) => void;
  resources: readonly Resource[];
  label?: string | undefined;
  error?: string | null | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

function ResourcePreview({ resource }: { resource: Resource }): JSX.Element {
  const parts = arnParts(resource.arn);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-13 font-medium text-text">{parts.resourceName || resource.arn}</p>
      <p className="mono text-micro break-all text-text-muted">{resource.arn}</p>
      <dl className="text-micro grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-text-subtle">
        <dt>Service</dt>
        <dd className="text-text-muted">{parts.service}</dd>
        <dt>Type</dt>
        <dd className="text-text-muted">{resource.type}</dd>
        <dt>Region</dt>
        <dd className="text-text-muted">{parts.region || 'global'}</dd>
        <dt>Account</dt>
        <dd className="text-text-muted">
          {resource.accountId ?? (parts.accountId === '' ? '—' : parts.accountId)}
        </dd>
      </dl>
      {Object.keys(resource.tags).length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {Object.entries(resource.tags).map(([key, tagValue]) => (
            <Badge key={key} variant="outline" hideIcon>
              {key}={tagValue}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ResourcePicker({
  value,
  onChange,
  resources,
  label = 'Resource',
  error = null,
  disabled = false,
  className,
}: ResourcePickerProps): JSX.Element {
  const items: ComboboxItem[] = resources.map((resource) => ({
    value: resource.arn,
    label: arnParts(resource.arn).resourceName || resource.arn,
    description: truncateArn(resource.arn),
    group: resource.type,
    keywords: [resource.arn, resource.type, ...Object.values(resource.tags)],
    disabled: resource.deleted,
    meta: (
      <Badge variant="muted" hideIcon>
        {resource.type}
      </Badge>
    ),
  }));

  const selected = resources.find((resource) => resource.arn === value) ?? null;

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
        placeholder="Select a resource…"
        searchPlaceholder="Search by ARN, type or tag…"
        emptyMessage={
          resources.length === 0
            ? 'No resources recorded yet. Add one so policies can target it.'
            : 'No resource matches that search.'
        }
      />

      {selected ? (
        <div className="mt-1 flex items-center gap-2">
          <HoverPreview content={<ResourcePreview resource={selected} />}>
            <span className="mono text-micro truncate text-text-subtle" title={selected.arn}>
              {truncateArn(selected.arn)}
            </span>
          </HoverPreview>
        </div>
      ) : null}
    </div>
  );
}
