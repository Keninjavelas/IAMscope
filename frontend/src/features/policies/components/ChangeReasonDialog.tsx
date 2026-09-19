import { useEffect, useState, type JSX } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Textarea';

export interface ChangeReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which change is being described - shown so the user knows the context. */
  summary: string;
  confirmLabel?: string | undefined;
  onConfirm: (reason: string) => void;
  pending?: boolean | undefined;
}

/**
 * Every policy mutation is versioned and audited, so it must carry a reason
 * (Plan §7.2 `policy_versions.changeReason`, §18 audit trail).
 */
export function ChangeReasonDialog({
  open,
  onOpenChange,
  summary,
  confirmLabel = 'Save changes',
  onConfirm,
  pending = false,
}: ChangeReasonDialogProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const tooShort = reason.trim().length < 3;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Describe this change"
      description="The reason is stored with the new version and shown in the audit log."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            onClick={() => {
              setTouched(true);
              if (tooShort) return;
              onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-13 rounded-input border border-border bg-bg-inset px-2 py-1.5 text-text-muted">
          {summary}
        </p>
        <Textarea
          label="Reason"
          autoFocus
          rows={3}
          value={reason}
          placeholder="e.g. Tighten s3:GetObject to the reports prefix"
          error={touched && tooShort ? 'Give at least a few words - it is the audit trail.' : null}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
