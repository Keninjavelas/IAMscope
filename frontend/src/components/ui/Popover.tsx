import { useState, type ReactNode, type JSX } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';

export type PopoverSide = 'top' | 'right' | 'bottom' | 'left';
export type PopoverAlign = 'start' | 'center' | 'end';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  side?: PopoverSide | undefined;
  align?: PopoverAlign | undefined;
  /** Uncontrolled unless `open` is supplied. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  width?: number | undefined;
  className?: string | undefined;
  /** Padding wrapper is applied by default; disable for edge-to-edge lists. */
  padded?: boolean | undefined;
}

export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  open,
  onOpenChange,
  width,
  className,
  padded = true,
}: PopoverProps): JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : uncontrolledOpen;

  const handleOpenChange = (next: boolean): void => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <RadixPopover.Root open={resolvedOpen} onOpenChange={handleOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          style={width === undefined ? undefined : { width }}
          className={cn(
            'overlay-surface dur-fast ease-out-brand z-50 max-w-[min(420px,calc(100vw-24px))] text-13 text-text outline-none',
            'data-[state=open]:opacity-100 data-[state=closed]:opacity-0',
            padded && 'p-3',
            className,
          )}
        >
          {children}
          <RadixPopover.Arrow className="fill-border-strong" width={10} height={5} />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export interface HoverPreviewProps {
  /** The thing being hovered (usually a truncated ARN). */
  children: ReactNode;
  /** Summary popover content. */
  content: ReactNode;
  width?: number | undefined;
}

/**
 * Hover-to-preview (Plan §15.4). Built on Popover so the same content is also
 * reachable by keyboard: the trigger keeps its own focus behaviour.
 */
export function HoverPreview({ children, content, width = 320 }: HoverPreviewProps): JSX.Element {
  return (
    <Popover
      width={width}
      side="bottom"
      align="start"
      trigger={
        <span className="inline-flex max-w-full cursor-help" tabIndex={0}>
          {children}
        </span>
      }
    >
      {content}
    </Popover>
  );
}
