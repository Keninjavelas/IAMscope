import { useEffect, useState, type JSX } from 'react';
import { Plus, Save } from 'lucide-react';
import type { Resource } from '@iamscope/types';
import { useCreateResource, useUpdateResource } from '@/api/mutations/resources';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';

export interface ResourceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: Resource | null;
}

export function ResourceFormDialog({
  open,
  onOpenChange,
  resource = null,
}: ResourceFormDialogProps): JSX.Element {
  const create = useCreateResource();
  const update = useUpdateResource();
  const isEdit = resource !== null;

  const [arn, setArn] = useState('');
  const [type, setType] = useState('');
  const [accountId, setAccountId] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setArn(resource?.arn ?? '');
    setType(resource?.type ?? '');
    setAccountId(resource?.accountId ?? '');
  }, [open, resource]);

  const arnInvalid = !/^arn:[^\s]+:[^\s]*:[^\s]*:[^\s]*:.+$/.test(arn.trim());
  const typeInvalid = type.trim() === '';
  const arnError = submitted && arnInvalid ? 'That does not look like an ARN.' : null;
  const typeError = submitted && typeInvalid ? 'A type is required (e.g. S3Object).' : null;

  const submit = (): void => {
    setSubmitted(true);
    if (arnInvalid || typeInvalid) return;

    const payload = {
      arn: arn.trim(),
      type: type.trim(),
      accountId: accountId.trim() === '' ? null : accountId.trim(),
    };

    if (resource) {
      update.mutate({ id: resource.id, ...payload }, { onSuccess: () => onOpenChange(false) });
      return;
    }
    create.mutate(payload, { onSuccess: () => onOpenChange(false) });
  };

  const error = create.error ?? update.error;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={isEdit ? `Edit ${resource.arn}` : 'New resource'}
      description="Resources are the ARNs policies point at. Registering one lets the pickers suggest it and lets scenarios target it."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={isEdit ? Save : Plus}
            loading={create.isPending || update.isPending}
            onClick={submit}
          >
            {isEdit ? 'Save resource' : 'Create resource'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="ARN"
          autoFocus
          required
          mono
          value={arn}
          error={arnError}
          placeholder="arn:aws:s3:::reports/2026/*"
          onChange={(event) => setArn(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Type"
            required
            value={type}
            error={typeError}
            placeholder="S3Object"
            onChange={(event) => setType(event.target.value)}
          />
          <Input
            label="Account ID"
            value={accountId}
            placeholder="123456789012"
            hint="Optional. Defaults to the account in the ARN."
            onChange={(event) => setAccountId(event.target.value)}
          />
        </div>

        {error ? (
          <p role="alert" className="text-meta text-danger">
            {error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
