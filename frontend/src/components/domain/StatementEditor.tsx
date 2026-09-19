import { useId, useState, type KeyboardEvent, type JSX } from 'react';
import { Ban, Check, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { CONDITION_OPERATORS, type PolicyCondition, type PolicyStatement } from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { isWildcardAction, isWildcardResource, lintStatement, newCondition } from '@/lib/iam';

/* ------------------------------------------------------------------ */
/* Chips                                                              */
/* ------------------------------------------------------------------ */

export interface ChipListProps {
  label: string;
  values: readonly string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  mono?: boolean;
  invalid?: (value: string) => boolean;
  warn?: (value: string) => boolean;
  describe?: (value: string) => string | undefined;
  readOnly?: boolean;
}

const CHIP_BASE =
  'inline-flex max-w-full items-center gap-1 rounded-input border px-1.5 py-0.5 text-12';

function ChipList({
  label,
  values,
  onChange,
  placeholder,
  mono = false,
  invalid,
  warn,
  describe,
  readOnly = false,
}: ChipListProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  const commit = (): void => {
    const value = draft.trim();
    if (value === '') return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-12 font-medium text-text-muted">
        {label}
      </label>

      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {values.map((value) => {
            const isInvalid = invalid?.(value) === true;
            const isWarn = !isInvalid && warn?.(value) === true;
            const description = describe?.(value);
            return (
              <li key={value}>
                <span
                  title={description ?? value}
                  className={cn(
                    CHIP_BASE,
                    isInvalid
                      ? 'border-danger/50 bg-danger-subtle text-danger'
                      : isWarn
                        ? 'border-warn/50 bg-warn-subtle text-warn'
                        : 'border-border bg-bg-inset text-text',
                  )}
                >
                  {isInvalid || isWarn ? (
                    <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
                  ) : null}
                  <span className={cn('min-w-0 truncate', mono && 'mono')}>{value}</span>
                  <span className="sr-only">
                    {isInvalid ? 'invalid' : isWarn ? 'wildcard, review this' : ''}
                  </span>
                  {readOnly ? null : (
                    <button
                      type="button"
                      aria-label={`Remove ${value}`}
                      className="dur-fast shrink-0 rounded-[2px] outline-none hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      onClick={() => onChange(values.filter((entry) => entry !== value))}
                    >
                      <X aria-hidden="true" className="size-3" />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-micro text-text-subtle">None yet.</p>
      )}

      {readOnly ? null : (
        <div className="flex items-center gap-1">
          <Input
            id={inputId}
            inputSize="sm"
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label={`Add to ${label}`}
            className={mono ? 'mono' : undefined}
          />
          <IconButton label={`Add to ${label}`} icon={Plus} size="sm" onClick={commit} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Statement editor                                                   */
/* ------------------------------------------------------------------ */

export interface StatementEditorProps {
  statement: PolicyStatement;
  index: number;
  onChange: (next: PolicyStatement) => void;
  onRemove: () => void;
  readOnly?: boolean | undefined;
}

const OPERATOR_OPTIONS = CONDITION_OPERATORS.map((operator) => ({
  value: operator,
  label: operator,
}));

export function StatementEditor({
  statement,
  index,
  onChange,
  onRemove,
  readOnly = false,
}: StatementEditorProps): JSX.Element {
  const isDeny = statement.effect === 'Deny';
  const warnings = lintStatement(statement);

  const patch = (changes: Partial<PolicyStatement>): void => onChange({ ...statement, ...changes });

  const updateCondition = (conditionIndex: number, next: PolicyCondition): void => {
    patch({
      conditions: statement.conditions.map((condition, position) =>
        position === conditionIndex ? next : condition,
      ),
    });
  };

  return (
    <article
      className="flex flex-col gap-3 rounded-card border border-border bg-bg-raised p-3"
      aria-label={`Statement ${index + 1}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-12 font-medium text-text-subtle">#{index + 1}</span>

          <fieldset className="flex items-center gap-1" disabled={readOnly}>
            <legend className="sr-only">Effect</legend>
            <button
              type="button"
              aria-pressed={!isDeny}
              onClick={() => patch({ effect: 'Allow' })}
              className={cn(
                'dur-fast inline-flex items-center gap-1 rounded-input border px-2 py-0.5 text-12 font-medium outline-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                !isDeny
                  ? 'border-allow/50 bg-success-subtle text-allow'
                  : 'border-border bg-bg-inset text-text-muted hover:text-text',
              )}
            >
              <Check aria-hidden="true" className="size-3" />
              Allow
            </button>
            <button
              type="button"
              aria-pressed={isDeny}
              onClick={() => patch({ effect: 'Deny' })}
              className={cn(
                'dur-fast inline-flex items-center gap-1 rounded-input border px-2 py-0.5 text-12 font-medium outline-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                isDeny
                  ? 'border-deny/50 bg-danger-subtle text-deny'
                  : 'border-border bg-bg-inset text-text-muted hover:text-text',
              )}
            >
              <Ban aria-hidden="true" className="size-3" />
              Deny
            </button>
          </fieldset>

          {isDeny ? <Badge variant="deny">Explicit deny wins</Badge> : null}
        </div>

        <div className="flex items-center gap-1">
          <Input
            inputSize="sm"
            value={statement.sid}
            readOnly={readOnly}
            placeholder="Sid (optional)"
            aria-label={`Statement ${index + 1} Sid`}
            onChange={(event) => patch({ sid: event.target.value })}
            wrapperClassName="w-[180px]"
            className="mono"
          />
          <IconButton
            label={`Remove statement ${index + 1}`}
            icon={Trash2}
            size="sm"
            variant="ghost"
            disabled={readOnly}
            onClick={onRemove}
          />
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <ChipList
          label="Actions"
          values={statement.actions}
          readOnly={readOnly}
          mono
          placeholder="s3:GetObject"
          onChange={(actions) => patch({ actions })}
          warn={isWildcardAction}
          describe={(action) =>
            action === '*'
              ? 'Every action in every service'
              : isWildcardAction(action)
                ? 'Wildcard pattern'
                : undefined
          }
        />
        <ChipList
          label="Resources"
          values={statement.resources}
          readOnly={readOnly}
          mono
          placeholder="arn:aws:s3:::bucket/*"
          onChange={(resources) => patch({ resources })}
          warn={isWildcardResource}
          describe={(resource) =>
            resource === '*'
              ? 'Every resource in this account'
              : isWildcardResource(resource)
                ? 'Pattern match'
                : undefined
          }
        />
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-12 font-medium text-text-muted">Conditions</h4>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={Plus}
            disabled={readOnly}
            onClick={() => patch({ conditions: [...statement.conditions, newCondition()] })}
          >
            Add condition
          </Button>
        </div>

        {statement.conditions.length === 0 ? (
          <p className="text-micro text-text-subtle">
            No conditions - the statement matches on action and resource alone.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {statement.conditions.map((condition, conditionIndex) => (
              <li
                key={`${condition.operator}-${condition.key}-${conditionIndex}`}
                className="flex flex-wrap items-end gap-2"
              >
                <Select
                  className="w-[170px]"
                  size="sm"
                  label="Operator"
                  value={condition.operator}
                  disabled={readOnly}
                  options={OPERATOR_OPTIONS}
                  onValueChange={(operator) =>
                    updateCondition(conditionIndex, {
                      ...condition,
                      operator: operator as PolicyCondition['operator'],
                    })
                  }
                />
                <Input
                  inputSize="sm"
                  label="Key"
                  className="mono"
                  wrapperClassName="w-[200px]"
                  value={condition.key}
                  readOnly={readOnly}
                  placeholder="aws:RequestedRegion"
                  onChange={(event) =>
                    updateCondition(conditionIndex, { ...condition, key: event.target.value })
                  }
                />
                <Input
                  inputSize="sm"
                  label="Values (comma separated)"
                  wrapperClassName="min-w-[200px] flex-1"
                  value={condition.values.join(', ')}
                  readOnly={readOnly}
                  placeholder="us-east-1"
                  onChange={(event) =>
                    updateCondition(conditionIndex, {
                      ...condition,
                      values: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter((value) => value !== ''),
                    })
                  }
                />
                <IconButton
                  label={`Remove condition ${conditionIndex + 1}`}
                  icon={Trash2}
                  size="sm"
                  disabled={readOnly}
                  onClick={() =>
                    patch({
                      conditions: statement.conditions.filter(
                        (_, position) => position !== conditionIndex,
                      ),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5 rounded-input border border-warn/40 bg-warn-subtle px-2 py-1.5">
          {warnings.map((warning) => (
            <li key={warning} className="text-micro flex items-start gap-1.5 text-warn">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
