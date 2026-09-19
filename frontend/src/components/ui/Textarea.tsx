import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode | undefined;
  hint?: ReactNode | undefined;
  error?: string | null | undefined;
  mono?: boolean | undefined;
  wrapperClassName?: string | undefined;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    error,
    mono = false,
    rows = 4,
    className,
    wrapperClassName,
    id,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const textareaId = id ?? `textarea-${generatedId}`;
  const hintId = `${textareaId}-hint`;
  const errorId = `${textareaId}-error`;
  const describedBy =
    [ariaDescribedBy, hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={cn('flex w-full flex-col gap-1', wrapperClassName)}>
      {label ? (
        <label htmlFor={textareaId} className="text-12 font-medium text-text-muted">
          {label}
        </label>
      ) : null}

      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'dur-fast w-full resize-y rounded-input border bg-bg-inset p-2 text-13 text-text outline-none transition-colors',
          'placeholder:text-text-subtle focus:border-accent focus:ring-1 focus:ring-accent',
          error ? 'border-danger' : 'border-border-strong',
          mono && 'mono text-12 leading-relaxed',
          className,
        )}
        {...rest}
      />

      {hint && !error ? (
        <p id={hintId} className="text-micro text-text-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-micro text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
