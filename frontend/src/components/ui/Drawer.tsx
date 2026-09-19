import type { ReactNode, JSX } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cn } from '@/lib/cn';

export type DrawerSide = 'right' | 'left' | 'bottom';
export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';

/** Widths for left/right, height for bottom. */
const SIZES: Record<DrawerSize, string> = {
  sm: '320px',
  md: '440px',
  lg: '620px',
  xl: '820px',
};

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: DrawerSide | undefined;
  title: ReactNode;
  description?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  children: ReactNode;
  size?: DrawerSize | undefined;
}

export function Drawer({
  open,
  onOpenChange,
  side = 'right',
  title,
  description,
  footer,
  children,
  size = 'md',
}: DrawerProps): JSX.Element {
  const dimension = SIZES[size];
  const isBottom = side === 'bottom';

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dur-normal fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <RadixDialog.Content
          style={isBottom ? { height: dimension } : { width: `min(${dimension}, 100vw)` }}
          className={cn(
            'overlay-surface dur-normal ease-out-brand fixed z-50 flex flex-col outline-none',
            isBottom ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-b-none' : 'inset-y-0 max-w-full',
            side === 'right' && 'right-0',
            side === 'left' && 'left-0',
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
            <RadixDialog.Close asChild>
              <IconButton label="Close panel" icon={X} size="sm" />
            </RadixDialog.Close>
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
