import { useEffect, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2 } from 'lucide-react';
import type { Policy, PolicyStatement } from '@iamscope/types';
import { useCreatePolicy, useUpdatePolicy } from '@/api/mutations/policies';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { PolicyEditor } from '@/components/domain/PolicyEditor';
import { newStatement } from '@/lib/iam';
import { policyRoutes } from '@/lib/constants';

export interface PolicyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing policy. */
  policy?: Policy | null | undefined;
  onSaved?: ((policy: Policy) => void) | undefined;
}

interface TagRow {
  key: string;
  value: string;
}

export function PolicyFormDialog({
  open,
  onOpenChange,
  policy = null,
  onSaved,
}: PolicyFormDialogProps): JSX.Element {
  const navigate = useNavigate();
  const createPolicy = useCreatePolicy();
  const updatePolicy = useUpdatePolicy();

  const [name, setName] = useState('');
  const [statements, setStatements] = useState<PolicyStatement[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const isEdit = policy !== null;
  const pending = createPolicy.isPending || updatePolicy.isPending;

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setChangeReason('');
    if (policy) {
      setName(policy.name);
      setStatements(policy.statements);
      setTags(Object.entries(policy.tags).map(([key, value]) => ({ key, value })));
      return;
    }
    setName('');
    setStatements([newStatement(0)]);
    setTags([]);
  }, [open, policy]);

  const nameInvalid = name.trim() === '';
  const reasonInvalid = changeReason.trim().length < 3;
  const nameError = submitted && nameInvalid ? 'A policy needs a name.' : null;
  const reasonError = submitted && reasonInvalid ? 'Describe why this change is being made.' : null;

  const toTags = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const row of tags) {
      if (row.key.trim() === '') continue;
      out[row.key.trim()] = row.value.trim();
    }
    return out;
  };

  const submit = (): void => {
    setSubmitted(true);
    if (nameInvalid || reasonInvalid) return;

    if (policy) {
      updatePolicy.mutate(
        {
          id: policy.id,
          statements,
          changeReason: changeReason.trim(),
          tags: toTags(),
        },
        {
          onSuccess: (saved) => {
            onOpenChange(false);
            onSaved?.(saved);
            navigate(policyRoutes.detail(saved.id));
          },
        },
      );
      return;
    }

    createPolicy.mutate(
      {
        name: name.trim(),
        statements,
        tags: toTags(),
        changeReason: changeReason.trim(),
      },
      {
        onSuccess: (created) => {
          onOpenChange(false);
          onSaved?.(created);
          navigate(policyRoutes.detail(created.id));
        },
      },
    );
  };

  const error = createPolicy.error ?? updatePolicy.error;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? `Edit ${policy.name}` : 'New policy'}
      description={
        isEdit
          ? 'Saving creates a new immutable version and re-evaluates the org.'
          : 'The ARN is generated from the policy name inside your organization.'
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={FilePlus2}
            loading={pending}
            onClick={submit}
          >
            {isEdit ? 'Save new version' : 'Create policy'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Policy name"
            autoFocus
            required
            value={name}
            readOnly={isEdit}
            hint={isEdit ? 'Names are immutable - the ARN depends on it.' : undefined}
            error={nameError}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label="Change reason"
            required
            value={changeReason}
            placeholder="Why is this changing?"
            error={reasonError}
            onChange={(event) => setChangeReason(event.target.value)}
          />
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-12 font-medium text-text-muted">Tags</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setTags((previous) => [...previous, { key: '', value: '' }])}
            >
              Add tag
            </Button>
          </div>
          {tags.length === 0 ? (
            <p className="text-micro text-text-subtle">No tags. Tags power the list filters.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tags.map((row, index) => (
                <li key={index} className="flex items-end gap-2">
                  <Input
                    inputSize="sm"
                    label="Key"
                    value={row.key}
                    wrapperClassName="w-[180px]"
                    onChange={(event) =>
                      setTags((previous) =>
                        previous.map((entry, position) =>
                          position === index ? { ...entry, key: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <Input
                    inputSize="sm"
                    label="Value"
                    value={row.value}
                    onChange={(event) =>
                      setTags((previous) =>
                        previous.map((entry, position) =>
                          position === index ? { ...entry, value: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTags((previous) => previous.filter((_, p) => p !== index))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <PolicyEditor statements={statements} onChange={setStatements} />

        {error ? (
          <p role="alert" className="text-meta text-danger">
            {error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
