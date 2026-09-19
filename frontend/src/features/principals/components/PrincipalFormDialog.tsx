import { useEffect, useState, type JSX } from 'react';
import { Plus, Save } from 'lucide-react';
import { PRINCIPAL_TYPES, type Principal, type PrincipalType } from '@iamscope/types';
import { useCreatePrincipal, useUpdatePrincipal } from '@/api/mutations/principals';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

const TYPE_OPTIONS = PRINCIPAL_TYPES.map((type) => ({ value: type, label: type }));

export interface PrincipalFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  principal?: Principal | null;
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function PrincipalFormDialog({
  open,
  onOpenChange,
  principal = null,
}: PrincipalFormDialogProps): JSX.Element {
  const create = useCreatePrincipal();
  const update = useUpdatePrincipal();
  const isEdit = principal !== null;

  const [type, setType] = useState<PrincipalType>('Role');
  const [name, setName] = useState('');
  const [arn, setArn] = useState('');
  const [groups, setGroups] = useState('');
  const [targets, setTargets] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setType(principal?.type ?? 'Role');
    setName(principal?.name ?? '');
    setArn(principal?.arn ?? '');
    setGroups(principal?.groupMemberships.join('\n') ?? '');
    setTargets(principal?.assumeRoleTargets.join('\n') ?? '');
  }, [open, principal]);

  const nameInvalid = name.trim() === '';
  const arnInvalid = !/^arn:[^\s]+:[^\s]*:[^\s]*:[^\s]*:.+$/.test(arn.trim());
  const nameError = submitted && nameInvalid ? 'A name is required.' : null;
  const arnError =
    submitted && arnInvalid
      ? 'That does not look like an ARN (arn:aws:iam::123456789012:role/name).'
      : null;

  const submit = (): void => {
    setSubmitted(true);
    if (nameInvalid || arnInvalid) return;

    const payload = {
      type,
      name: name.trim(),
      arn: arn.trim(),
      groupMemberships: parseLines(groups),
      assumeRoleTargets: parseLines(targets),
    };

    if (principal) {
      update.mutate({ id: principal.id, ...payload }, { onSuccess: () => onOpenChange(false) });
      return;
    }
    create.mutate(payload, { onSuccess: () => onOpenChange(false) });
  };

  const error = create.error ?? update.error;
  const pending = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={isEdit ? `Edit ${principal.name}` : 'New principal'}
      description="A principal is a User, Role or Group. Its ARN is how policies and scenarios refer to it."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={isEdit ? Save : Plus}
            loading={pending}
            onClick={submit}
          >
            {isEdit ? 'Save principal' : 'Create principal'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <Select
            label="Type"
            value={type}
            options={TYPE_OPTIONS}
            onValueChange={(value) => setType(value as PrincipalType)}
          />
          <Input
            label="Name"
            autoFocus
            required
            value={name}
            error={nameError}
            placeholder="DataAnalyst"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <Input
          label="ARN"
          required
          mono
          value={arn}
          error={arnError}
          placeholder="arn:aws:iam::123456789012:role/DataAnalyst"
          onChange={(event) => setArn(event.target.value)}
        />

        {type === 'User' ? (
          <Textarea
            label="Group memberships"
            mono
            rows={3}
            value={groups}
            hint="One group ARN or name per line."
            onChange={(event) => setGroups(event.target.value)}
          />
        ) : null}

        <Textarea
          label="Assume-role targets"
          mono
          rows={3}
          value={targets}
          hint="One role ARN per line that this principal can sts:AssumeRole into. These edges feed the Graph lens."
          onChange={(event) => setTargets(event.target.value)}
        />

        {error ? (
          <p role="alert" className="text-meta text-danger">
            {error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
