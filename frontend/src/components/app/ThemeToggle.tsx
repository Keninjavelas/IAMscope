import { useState, type JSX } from 'react';
import { Check, Monitor, Moon, Palette, Sun, type LucideIcon } from 'lucide-react';
import { ACCENTS, type Accent } from '@iamscope/tokens';
import type { ThemeMode } from '@iamscope/types';
import { IconButton } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { useTheme } from '@/hooks/useTheme';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

const THEME_ICONS: Record<ThemeMode, LucideIcon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

const THEME_LABELS: Record<ThemeMode, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};

const ACCENT_SWATCH: Record<Accent, string> = {
  blue: 'oklch(0.68 0.16 250)',
  violet: 'oklch(0.65 0.19 295)',
  teal: 'oklch(0.68 0.13 190)',
  amber: 'oklch(0.75 0.15 80)',
  rose: 'oklch(0.66 0.19 10)',
  green: 'oklch(0.68 0.15 150)',
};

export function ThemeToggle(): JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const accent = useUiStore((state) => state.accent);
  const setAccent = useUiStore((state) => state.setAccent);
  const [open, setOpen] = useState(false);

  const TriggerIcon = THEME_ICONS[theme];

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={260}
      align="end"
      trigger={
        <IconButton
          label={`Appearance: ${THEME_LABELS[theme]} (${resolvedTheme}) theme, ${accent} accent`}
          icon={TriggerIcon}
          size="sm"
        />
      }
    >
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-0.5">
          <p className="text-micro flex items-center gap-1 px-1 pb-0.5 font-medium text-text-subtle">
            <Palette aria-hidden="true" className="size-3" /> Theme
          </p>
          {(Object.keys(THEME_LABELS) as ThemeMode[]).map((mode) => {
            const Icon = THEME_ICONS[mode];
            const selected = theme === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(mode)}
                className={cn(
                  'dur-fast flex items-center gap-2 rounded-input px-2 py-1.5 text-left text-13 outline-none',
                  'hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  selected ? 'bg-bg-selected text-text' : 'text-text-muted',
                )}
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="flex-1">{THEME_LABELS[mode]}</span>
                {selected ? <Check aria-hidden="true" className="size-3.5 text-accent" /> : null}
              </button>
            );
          })}
        </div>

        <div role="radiogroup" aria-label="Accent colour" className="flex flex-col gap-1">
          <p className="text-micro px-1 font-medium text-text-subtle">Accent</p>
          <div className="flex items-center gap-1.5 px-1">
            {ACCENTS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={accent === option}
                aria-label={`${option} accent`}
                title={`${option} accent`}
                onClick={() => setAccent(option)}
                style={{ backgroundColor: ACCENT_SWATCH[option] }}
                className={cn(
                  'dur-fast size-5 rounded-full border outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  accent === option ? 'border-text' : 'border-transparent',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </Popover>
  );
}
