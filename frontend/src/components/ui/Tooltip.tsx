import type { ReactNode, JSX } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { PopoverSide } from './Popover';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: PopoverSide | undefined;
  delayMs?: number | undefined;
}

/**
 * Tooltips never carry information that exists nowhere else (Plan §15.7) - they
 * only accelerate discovery. Any element using one must also have an accessible
 * name of its own.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  delayMs = 400,
}: TooltipProps): JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={delayMs}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="overlay-surface dur-fast z-50 max-w-[280px] px-2 py-1 text-12 text-text"
          >
            {content}
            <RadixTooltip.Arrow className="fill-border-strong" width={10} height={5} />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

/** Gives `App.tsx` a single provider for the whole tree. */
export const TooltipProvider = RadixTooltip.Provider;
