import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: ReactNode | undefined;
  hint?: ReactNode | undefined;
  error?: string | null | undefined;
  prefix?: ReactNode | undefined;
  suffix?: ReactNode | undefined;
  inputSize?: 'sm' | 'md' | undefined;
  /** Render the value in the mono stack - for ARNs, tokens and actions. */
  mono?: boolean | undefined;
  /** Extra class for the wrapper (the input gets `className`). */
  wrapperClassName?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    prefix,
    suffix,
    inputSize = 'md',
    mono = false,
    className,
    wrapperClassName,
    id,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [ariaDescribedBy, hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={cn('flex w-full flex-col gap-1', wrapperClassName)}>
      {label ? (
        <label htmlFor={inputId} className="text-12 font-medium text-text-muted">
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          'dur-fast flex items-center gap-1.5 rounded-input border bg-bg-inset px-2 transition-colors',
          'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
          error ? 'border-danger' : 'border-border-strong',
          inputSize === 'sm' ? 'h-6' : 'control-height',
        )}
      >
        {prefix ? <span className="shrink-0 text-text-subtle">{prefix}</span> : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'min-w-0 flex-1 border-0 bg-transparent p-0 text-13 text-text outline-none placeholder:text-text-subtle',
            inputSize === 'sm' && 'text-12',
            mono && 'mono',
            className,
          )}
          {...rest}
        />
        {suffix ? <span className="shrink-0 text-text-subtle">{suffix}</span> : null}
      </div>

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
