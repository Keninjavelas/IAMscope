import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Undo2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { MOTION } from '@iamscope/tokens';
import { cn } from '@/lib/cn';

export type ToastVariant = 'info' | 'success' | 'error' | 'warn';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string | undefined;
  variant?: ToastVariant;
  durationMs?: number | undefined;
  action?: ToastAction | undefined;
  onUndo?: (() => void) | undefined;
}

export interface ToastItem extends ToastOptions {
  id: string;
  createdAt: number;
}

export interface UndoableOptions {
  title: string;
  description?: string | undefined;
  onUndo: () => void;
  durationMs?: number | undefined;
}

/** Max visible toasts (Plan §15.3) - older ones are dropped, not stacked forever. */
export const MAX_VISIBLE_TOASTS = 4;

const DEFAULT_DURATION = MOTION.toastDurationMs;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${Date.now().toString(36)}-${counter}`;
}

interface ToastState {
  toasts: ToastItem[];
  push: (item: ToastItem) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (item) => {
    const next = [...get().toasts, item];
    // Cap the stack so a burst of SSE-driven toasts cannot cover the app.
    set({
      toasts:
        next.length > MAX_VISIBLE_TOASTS ? next.slice(next.length - MAX_VISIBLE_TOASTS) : next,
    });
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  clear: () => set({ toasts: [] }),
}));

/* ------------------------------------------------------------------ */
/* Dismissal timers (module scope, so they never trigger a render)     */
/* ------------------------------------------------------------------ */

interface TimerEntry {
  handle: ReturnType<typeof setTimeout>;
  remaining: number;
  startedAt: number;
}

const timers = new Map<string, TimerEntry>();

function schedule(id: string, durationMs: number): void {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing.handle);
  if (durationMs <= 0) return;
  timers.set(id, {
    handle: setTimeout(() => {
      timers.delete(id);
      useToastStore.getState().dismiss(id);
    }, durationMs),
    remaining: durationMs,
    startedAt: Date.now(),
  });
}

/** Pause-on-hover: freeze every visible toast and remember how long is left. */
function pauseAll(): void {
  for (const [, entry] of timers) {
    clearTimeout(entry.handle);
    const elapsed = Date.now() - entry.startedAt;
    entry.remaining = Math.max(400, entry.remaining - elapsed);
    entry.startedAt = Date.now();
  }
}

function resumeAll(): void {
  for (const [id, entry] of timers) schedule(id, entry.remaining);
}

/* ------------------------------------------------------------------ */
/* The hook                                                           */
/* ------------------------------------------------------------------ */

export interface ToastApi {
  toast: (options: ToastOptions) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warn: (title: string, description?: string) => string;
  undoable: (options: UndoableOptions) => string;
  dismiss: (id: string) => void;
}

export function useToast(): ToastApi {
  const push = useToastStore((state) => state.push);
  const dismiss = useToastStore((state) => state.dismiss);

  const toast = useCallback(
    (options: ToastOptions): string => {
      const id = nextId();
      const durationMs = options.durationMs ?? DEFAULT_DURATION;
      push({ ...options, id, createdAt: Date.now(), durationMs });
      schedule(id, durationMs);
      return id;
    },
    [push],
  );

  return useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: 'success' }),
      error: (title, description) => toast({ title, description, variant: 'error' }),
      info: (title, description) => toast({ title, description, variant: 'info' }),
      warn: (title, description) => toast({ title, description, variant: 'warn' }),
      undoable: ({ title, description, onUndo, durationMs }) =>
        toast({
          title,
          description,
          variant: 'info',
          durationMs: durationMs ?? DEFAULT_DURATION,
          action: { label: 'Undo', onClick: onUndo },
          onUndo,
        }),
      dismiss,
    }),
    [dismiss, toast],
  );
}

/* ------------------------------------------------------------------ */
/* Presentation                                                       */
/* ------------------------------------------------------------------ */

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
  warn: AlertTriangle,
};

const VARIANT_TEXT: Record<ToastVariant, string> = {
  info: 'text-info',
  success: 'text-success',
  error: 'text-danger',
  warn: 'text-warn',
};

const VARIANT_BORDER: Record<ToastVariant, string> = {
  info: 'border-l-info',
  success: 'border-l-success',
  error: 'border-l-danger',
  warn: 'border-l-warn',
};

function ToastRow({ item }: { item: ToastItem }): JSX.Element {
  const dismiss = useToastStore((state) => state.dismiss);
  const variant: ToastVariant = item.variant ?? 'info';
  const Icon = VARIANT_ICON[variant];

  return (
    <div
      className={cn(
        'overlay-surface dur-fast ease-out-brand pointer-events-auto flex w-[380px] max-w-[calc(100vw-32px)] gap-3 border-l-2 p-3 transition-all',
        VARIANT_BORDER[variant],
      )}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', VARIANT_TEXT[variant])} />
      <div className="min-w-0 flex-1">
        <p className="text-13 font-medium text-text">{item.title}</p>
        {item.description ? (
          <p className="text-meta mt-0.5 text-text-muted">{item.description}</p>
        ) : null}
        {item.action ? (
          <button
            type="button"
            className="text-13 dur-fast mt-1.5 inline-flex items-center gap-1 rounded-input font-medium text-accent outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => {
              item.action?.onClick();
              dismiss(item.id);
            }}
          >
            {item.action.label === 'Undo' ? (
              <Undo2 aria-hidden="true" className="size-3.5" />
            ) : null}
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Dismiss notification: ${item.title}`}
        className="dur-fast -mt-0.5 -mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-input text-text-subtle outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={() => dismiss(item.id)}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

export function Toaster(): JSX.Element | null {
  const toasts = useToastStore((state) => state.toasts);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById('portal-root') ?? document.body);
  }, []);

  useEffect(() => {
    if (!target) return;
    target.addEventListener('mouseenter', pauseAll);
    target.addEventListener('mouseleave', resumeAll);
    target.addEventListener('focusin', pauseAll);
    target.addEventListener('focusout', resumeAll);
    return () => {
      target.removeEventListener('mouseenter', pauseAll);
      target.removeEventListener('mouseleave', resumeAll);
      target.removeEventListener('focusin', pauseAll);
      target.removeEventListener('focusout', resumeAll);
    };
  }, [target]);

  if (!target) return null;

  return createPortal(
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col-reverse gap-2"
    >
      {toasts.map((item) => (
        <ToastRow key={item.id} item={item} />
      ))}
    </section>,
    target,
  );
}

/** `ToastToaster` is the name referenced by `App.tsx`; same component. */
export const ToastToaster = Toaster;
