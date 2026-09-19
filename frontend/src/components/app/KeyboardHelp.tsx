import type { JSX } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Kbd } from '@/components/ui/Kbd';
import { Button } from '@/components/ui/Button';
import { groupKeymap } from '@/hooks/useKeyboard';
import { useUiStore } from '@/stores/ui';

/**
 * `?` opens this overlay (Plan §15.4). It is generated from `KEYBOARD_MAP`, so a
 * binding can never exist without being documented.
 */
export function KeyboardHelp(): JSX.Element {
  const open = useUiStore((state) => state.keyboardHelpOpen);
  const setOpen = useUiStore((state) => state.setKeyboardHelpOpen);
  const sections = groupKeymap();

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title="Keyboard shortcuts"
      description="Every action in IAMScope is reachable without a mouse."
      footer={
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      }
    >
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {sections.map((section) => (
          <section key={section.group} aria-labelledby={`keymap-${section.group}`}>
            <h3
              id={`keymap-${section.group}`}
              className="text-micro mb-1.5 font-semibold tracking-wide text-text-subtle uppercase"
            >
              {section.group}
            </h3>
            <dl className="flex flex-col gap-1">
              {section.entries.map((entry) => (
                <div key={entry.keys} className="flex items-center justify-between gap-3 py-0.5">
                  <dt className="text-13 text-text-muted">{entry.description}</dt>
                  <dd className="shrink-0">
                    <Kbd keys={entry.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="text-micro mt-5 border-t border-border pt-3 text-text-subtle">
        Sequences like <Kbd keys="g p" /> mean: press <Kbd keys="g" />, then <Kbd keys="p" /> within
        a second. Shortcuts are suppressed while a code editor has focus.
      </p>
    </Dialog>
  );
}
