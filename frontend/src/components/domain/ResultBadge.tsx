import type { JSX } from 'react';
import { CheckCircle2, HelpCircle, MinusCircle } from 'lucide-react';
import type { PolicyEffect } from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

export interface ResultBadgeProps {
  result: PolicyEffect | null;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  /** Override the visible text (e.g. "Expected Allow"). */
  label?: string;
  className?: string;
}

/**
 * Allow / Deny / unknown. Plan §15.7: colour is never the only signal, so the
 * badge always carries a distinct icon and a text label.
 */
export function ResultBadge({
  result,
  size = 'sm',
  showIcon = true,
  label,
  className,
}: ResultBadgeProps): JSX.Element {
  if (result === null) {
    return (
      <Badge
        variant="muted"
        size={size}
        icon={showIcon ? HelpCircle : undefined}
        className={className}
      >
        {label ?? 'Unknown'}
      </Badge>
    );
  }

  const isAllow = result === 'Allow';
  const Icon = isAllow ? CheckCircle2 : MinusCircle;

  return (
    <Badge
      variant={isAllow ? 'allow' : 'deny'}
      size={size}
      icon={showIcon ? Icon : undefined}
      className={cn('font-medium', className)}
    >
      {label ?? result}
    </Badge>
  );
}
