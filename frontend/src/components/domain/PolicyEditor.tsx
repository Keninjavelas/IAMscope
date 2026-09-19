import { useEffect, useMemo, useState, type JSX } from 'react';
import { Braces, ListTree, Plus, TriangleAlert, Wand2 } from 'lucide-react';
import type { PolicyStatement } from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { StatementEditor } from './StatementEditor';
import { cn } from '@/lib/cn';
import { countByEffect, newStatement, parseStatementsJson, statementToJson } from '@/lib/iam';

export type PolicyEditorMode = 'structured' | 'json';

export interface PolicyEditorProps {
  statements: PolicyStatement[];
  onChange: (next: PolicyStatement[]) => void;
  readOnly?: boolean | undefined;
  error?: string | null | undefined;
}

/**
 * Two views over the same data (Plan §15.3):
 *  - structured: a `StatementEditor` per statement, with live wildcard linting
 *  - json: the canonical AWS policy document, linted by CodeMirror and validated
 *    against the shared zod schema before it is allowed to replace the model
 *
 * A parse failure never clobbers the statements the user already had.
 */
export function PolicyEditor({
  statements,
  onChange,
  readOnly = false,
  error = null,
}: PolicyEditorProps): JSX.Element {
  const [mode, setMode] = useState<PolicyEditorMode>('structured');
  const [draft, setDraft] = useState(() => statementToJson(statements));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Keep the buffer in sync while the structured view is the source of truth.
  useEffect(() => {
    if (mode === 'structured') setDraft(statementToJson(statements));
  }, [mode, statements]);

  const counts = useMemo(() => countByEffect(statements), [statements]);

  const handleJsonChange = (next: string): void => {
    setDraft(next);
    const parsed = parseStatementsJson(next);
    if (parsed.ok) {
      setJsonError(null);
      setWarnings(parsed.warnings);
      onChange(parsed.statements);
      return;
    }
    setJsonError(parsed.error);
  };

  const switchTo = (next: PolicyEditorMode): void => {
    if (next === mode) return;
    if (next === 'json') {
      setDraft(statementToJson(statements));
      setJsonError(null);
      setWarnings([]);
      setMode('json');
      return;
    }
    // Going back to the structured view requires a valid buffer.
    const parsed = parseStatementsJson(draft);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      return;
    }
    onChange(parsed.statements);
    setJsonError(null);
    setMode('structured');
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Policy editor">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Editor mode"
            className="flex items-center gap-1 rounded-input border border-border bg-bg-inset p-0.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'structured'}
              onClick={() => switchTo('structured')}
              className={cn(
                'dur-fast inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-12 outline-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                mode === 'structured' ? 'bg-bg-selected font-medium text-text' : 'text-text-muted',
              )}
            >
              <ListTree aria-hidden="true" className="size-3" />
              Structured
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'json'}
              onClick={() => switchTo('json')}
              className={cn(
                'dur-fast inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-12 outline-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                mode === 'json' ? 'bg-bg-selected font-medium text-text' : 'text-text-muted',
              )}
            >
              <Braces aria-hidden="true" className="size-3" />
              JSON
            </button>
          </div>

          <Badge variant="muted" hideIcon>
            {statements.length} {statements.length === 1 ? 'statement' : 'statements'}
          </Badge>
          <Badge variant="allow">{counts.Allow} allow</Badge>
          {counts.Deny > 0 ? <Badge variant="deny">{counts.Deny} deny</Badge> : null}
        </div>

        {mode === 'json' ? (
          <Button
            size="sm"
            variant="ghost"
            iconLeft={Wand2}
            disabled={readOnly}
            onClick={() => setDraft(statementToJson(statements))}
          >
            Format
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={Plus}
            disabled={readOnly}
            onClick={() => onChange([...statements, newStatement(statements.length)])}
          >
            Add statement
          </Button>
        )}
      </header>

      {mode === 'structured' ? (
        statements.length === 0 ? (
          <p className="text-13 rounded-card border border-border bg-bg-raised px-3 py-6 text-center text-text-muted">
            This policy has no statements yet. Add one to grant or deny something.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {statements.map((statement, index) => (
              <StatementEditor
                key={`${statement.sid}-${index}`}
                statement={statement}
                index={index}
                readOnly={readOnly}
                onChange={(next) =>
                  onChange(statements.map((entry, position) => (position === index ? next : entry)))
                }
                onRemove={() => onChange(statements.filter((_, position) => position !== index))}
              />
            ))}
          </div>
        )
      ) : (
        <CodeEditor
          value={draft}
          onChange={handleJsonChange}
          language="json"
          readOnly={readOnly}
          height={420}
          ariaLabel="Policy document JSON"
          error={jsonError}
          placeholder='{ "Version": "2012-10-17", "Statement": [] }'
          onSave={() => {
            const parsed = parseStatementsJson(draft);
            if (parsed.ok) {
              onChange(parsed.statements);
              setJsonError(null);
            } else {
              setJsonError(parsed.error);
            }
          }}
        />
      )}

      {jsonError ? (
        <p
          role="alert"
          className="text-meta flex items-start gap-1.5 rounded-input border border-danger/40 bg-danger-subtle px-2 py-1.5 text-danger"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{jsonError}</span>
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5 rounded-input border border-warn/40 bg-warn-subtle px-2 py-1.5">
          {warnings.slice(0, 5).map((warning) => (
            <li key={warning} className="text-micro flex items-start gap-1.5 text-warn">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
