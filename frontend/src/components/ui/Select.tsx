import { useId, type ReactNode, type JSX } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string | undefined;
  label?: ReactNode | undefined;
  error?: string | null | undefined;
  size?: 'sm' | 'md' | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** `aria-label` when no visible label is rendered. */
  ariaLabel?: string | undefined;
  name?: string | undefined;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  label,
  error,
  size = 'md',
  disabled = false,
  className,
  ariaLabel,
  name,
}: SelectProps): JSX.Element {
  const generatedId = useId();
  const triggerId = `select-${generatedId}`;

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={triggerId} className="text-12 font-medium text-text-muted">
          {label}
        </label>
      ) : null}

      <RadixSelect.Root
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        {...(name === undefined ? {} : { name })}
      >
        <RadixSelect.Trigger
          id={triggerId}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          aria-invalid={error ? true : undefined}
          className={cn(
            'dur-fast flex w-full items-center justify-between gap-2 rounded-input border bg-bg-inset px-2 text-left text-13 text-text outline-none transition-colors',
            'hover:bg-bg-hover focus:border-accent focus:ring-1 focus:ring-accent',
            'data-[placeholder]:text-text-subtle disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-danger' : 'border-border-strong',
            size === 'sm' ? 'h-6 text-12' : 'control-height',
          )}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon>
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className="overlay-surface dur-fast z-50 max-h-72 w-[var(--radix-select-trigger-width)] overflow-hidden p-1 text-13 text-text"
          >
            <RadixSelect.Viewport className="flex flex-col gap-0.5">
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled === true}
                  className={cn(
                    'dur-fast relative flex cursor-pointer items-center gap-2 rounded-input px-2 py-1 outline-none select-none',
                    'data-[highlighted]:bg-bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                    'data-[state=checked]:bg-bg-selected data-[state=checked]:text-text',
                  )}
                >
                  <RadixSelect.ItemIndicator className="shrink-0">
                    <Check aria-hidden="true" className="size-3.5 text-accent" />
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      {error ? (
        <p role="alert" className="text-micro text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
