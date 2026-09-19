import type { JSX } from 'react';
import type { ScenarioWithResult } from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { Combobox, type ComboboxItem } from '@/components/ui/Combobox';
import { HoverPreview } from '@/components/ui/Popover';
import { ResultBadge } from './ResultBadge';
import { arnName, truncateArn } from '@/lib/format';

export interface ScenarioPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  scenarios: readonly ScenarioWithResult[];
  label?: string | undefined;
  error?: string | null | undefined;
  showResult?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

function ScenarioPreview({ scenario }: { scenario: ScenarioWithResult }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-13 font-medium text-text">{scenario.name}</p>
      <dl className="text-micro grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-text-subtle">Principal</dt>
        <dd className="mono break-all text-text-muted">
          {truncateArn(scenario.principalArn, { max: 56 })}
        </dd>
        <dt className="text-text-subtle">Action</dt>
        <dd className="mono text-text-muted">{scenario.action}</dd>
        <dt className="text-text-subtle">Resource</dt>
        <dd className="mono break-all text-text-muted">
          {truncateArn(scenario.resourceArn, { max: 56 })}
        </dd>
        <dt className="text-text-subtle">Expected</dt>
        <dd>
          <ResultBadge
            result={scenario.expectedResult}
            label={`Expected ${scenario.expectedResult}`}
          />
        </dd>
        <dt className="text-text-subtle">Last run</dt>
        <dd>
          <ResultBadge result={scenario.lastResult} />
        </dd>
      </dl>
      {scenario.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {scenario.tags.map((tag) => (
            <Badge key={tag} variant="outline" hideIcon>
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ScenarioPicker({
  value,
  onChange,
  scenarios,
  label = 'Scenario',
  error = null,
  showResult = true,
  disabled = false,
  className,
}: ScenarioPickerProps): JSX.Element {
  const items: ComboboxItem[] = scenarios.map((scenario) => ({
    value: scenario.id,
    label: scenario.name,
    description: `${scenario.action} → ${arnName(scenario.resourceArn)}`,
    group: scenario.tags[0] ?? 'Scenarios',
    keywords: [scenario.action, scenario.principalArn, scenario.resourceArn, ...scenario.tags],
    meta: showResult ? (
      <span className="flex items-center gap-1">
        <ResultBadge result={scenario.lastResult} />
      </span>
    ) : undefined,
  }));

  const selected = scenarios.find((scenario) => scenario.id === value) ?? null;

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
        placeholder="Select a scenario…"
        searchPlaceholder="Search by name, action or tag…"
        emptyMessage={
          scenarios.length === 0
            ? 'No scenarios defined yet. A scenario is a saved access question.'
            : 'No scenario matches that search.'
        }
      />

      {selected ? (
        <div className="mt-1 flex items-center gap-2">
          <HoverPreview content={<ScenarioPreview scenario={selected} />}>
            <span className="text-micro truncate text-text-subtle" title={selected.name}>
              {selected.action} → {arnName(selected.resourceArn)}
            </span>
          </HoverPreview>
        </div>
      ) : null}
    </div>
  );
}
