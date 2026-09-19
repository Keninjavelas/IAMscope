import type { ReactNode, JSX } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cn } from '@/lib/cn';

export type DialogSize = 'sm' | 'md' | 'lg';

const SIZES: Record<DialogSize, string> = {
  sm: 'max-w-[400px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[840px]',
};

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  children: ReactNode;
  size?: DialogSize | undefined;
  /** Hide the close affordance for flows that must resolve explicitly. */
  hideClose?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Radix Dialog gives us the focus trap, focus restore, Esc-to-close and the
 * `aria-modal` wiring for free (Plan §15.4). We only own the chrome.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  size = 'md',
  hideClose = false,
  className,
}: DialogProps): JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dur-normal fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            'overlay-surface dur-normal ease-out-brand fixed top-1/2 left-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2',
            'flex max-h-[calc(100vh-64px)] flex-col outline-none',
            SIZES[size],
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <RadixDialog.Title className="text-14 font-semibold text-text">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-meta mt-0.5 text-text-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            {hideClose ? null : (
              <RadixDialog.Close asChild>
                <IconButton label="Close dialog" icon={X} size="sm" />
              </RadixDialog.Close>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>

          {footer ? (
            <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              {footer}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
