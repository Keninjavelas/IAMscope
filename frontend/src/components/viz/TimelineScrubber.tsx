import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { CalendarRange, ZoomIn } from 'lucide-react';
import type { TimelineEventMarker } from '@iamscope/types';
import { IconButton } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { clamp, formatDate, toDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { TimelineMarkers } from './TimelineMarkers';

export interface TimelineScrubberProps {
  /** Earliest reconstructable moment (organization creation). */
  min: string;
  /** Latest moment - normally "now". */
  max: string;
  value: string;
  markers: TimelineEventMarker[];
  onChange: (at: string) => void;
  onCommit?: ((at: string) => void) | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}

/** The handle snaps to a nearby event when it lands within this many pixels. */
const SNAP_PX = 8;
/** Zoom stops at five minutes: finer than the server's minute-level cache. */
const MIN_SPAN_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface DragState {
  pointerId: number;
  lastX: number;
  lastMs: number;
  lastTime: number;
  velocity: number;
}

function toMs(value: string): number | null {
  const date = toDate(value);
  return date === null ? null : date.getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The timeline scrubber (Plan §15.6).
 *
 * A horizontal track from org creation to now with a draggable handle that has
 * momentum and snaps within 8px of an event. Cmd/Ctrl + scroll zooms the time
 * axis, the range selector below pans it, and the whole control is operable from
 * the keyboard: arrows step by event, Shift+arrows by day, Home/End to the bounds.
 */
export function TimelineScrubber({
  min,
  max,
  value,
  markers,
  onChange,
  onCommit,
  loading = false,
  className,
}: TimelineScrubberProps): JSX.Element {
  const reducedMotion = useReducedMotion();

  const minMs = toMs(min) ?? 0;
  const maxMsRaw = toMs(max) ?? minMs + 1;
  const maxMs = Math.max(minMs + MIN_SPAN_MS, maxMsRaw);

  const [windowRange, setWindowRange] = useState<{ start: number; end: number }>({
    start: minMs,
    end: maxMs,
  });

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const momentumRef = useRef<number | null>(null);
  const widthRef = useRef(0);
  const valueRef = useRef(minMs);

  const valueMs = clamp(toMs(value) ?? maxMs, minMs, maxMs);
  valueRef.current = valueMs;

  // A new org (or a new range) resets the zoom window to the full extent.
  useEffect(() => {
    setWindowRange({ start: minMs, end: maxMs });
  }, [minMs, maxMs]);

  const span = Math.max(1, windowRange.end - windowRange.start);
  const pct = useCallback(
    (ms: number): number => clamp(((ms - windowRange.start) / span) * 100, 0, 100),
    [span, windowRange.start],
  );

  // Track width drives pixel-based snapping; measured once and on resize.
  useEffect(() => {
    const element = trackRef.current;
    if (element === null) return;
    const measure = (): void => {
      widthRef.current = element.getBoundingClientRect().width;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const snap = useCallback(
    (ms: number): number => {
      const width = widthRef.current > 0 ? widthRef.current : 1;
      const thresholdMs = (SNAP_PX / width) * span;
      let best: number | null = null;
      let bestDistance = thresholdMs;
      for (const marker of markers) {
        const at = toMs(marker.timestamp);
        if (at === null) continue;
        const distance = Math.abs(at - ms);
        if (distance < bestDistance) {
          best = at;
          bestDistance = distance;
        }
      }
      return best ?? ms;
    },
    [markers, span],
  );

  const emit = useCallback(
    (ms: number): void => {
      const next = clamp(snap(ms), minMs, maxMs);
      if (next === valueRef.current) return;
      valueRef.current = next;
      onChange(iso(next));
    },
    [maxMs, minMs, onChange, snap],
  );

  const msAtClientX = useCallback(
    (clientX: number): number => {
      const element = trackRef.current;
      if (element === null) return valueMs;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0) return valueMs;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return windowRange.start + ratio * span;
    },
    [span, valueMs, windowRange.start],
  );

  /* ---- Momentum ----------------------------------------------------- */

  const stopMomentum = useCallback((): void => {
    if (momentumRef.current !== null) {
      cancelAnimationFrame(momentumRef.current);
      momentumRef.current = null;
    }
  }, []);

  const startMomentum = useCallback(
    (velocity: number): void => {
      stopMomentum();
      if (reducedMotion || Math.abs(velocity) < 1e-5) {
        onCommit?.(iso(valueRef.current));
        return;
      }

      let speed = velocity;
      let previous = performance.now();

      const step = (now: number): void => {
        const delta = Math.max(1, now - previous);
        previous = now;
        // Exponential decay: the handle coasts, then settles.
        speed *= Math.pow(0.86, delta / 16.7);

        const next = valueRef.current + speed * delta;
        if (next <= minMs || next >= maxMs || Math.abs(speed) < 1e-5) {
          momentumRef.current = null;
          const bounded = clamp(snap(valueRef.current), minMs, maxMs);
          valueRef.current = bounded;
          onChange(iso(bounded));
          onCommit?.(iso(bounded));
          return;
        }
        emit(next);
        momentumRef.current = requestAnimationFrame(step);
      };

      momentumRef.current = requestAnimationFrame(step);
    },
    [emit, maxMs, minMs, onChange, onCommit, reducedMotion, snap, stopMomentum],
  );

  useEffect(() => stopMomentum, [stopMomentum]);

  /* ---- Cmd/Ctrl + scroll zooms the time axis ------------------------ */

  useEffect(() => {
    const element = trackRef.current;
    if (element === null) return;

    const onWheel = (event: WheelEvent): void => {
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);

      setWindowRange((previous) => {
        const currentSpan = Math.max(1, previous.end - previous.start);
        const factor = event.deltaY < 0 ? 0.8 : 1.25;
        const nextSpan = clamp(currentSpan * factor, MIN_SPAN_MS, maxMs - minMs);
        const anchor = previous.start + currentSpan * ratio;

        let start = anchor - nextSpan * ratio;
        let end = start + nextSpan;
        if (start < minMs) {
          start = minMs;
          end = Math.min(maxMs, start + nextSpan);
        }
        if (end > maxMs) {
          end = maxMs;
          start = Math.max(minMs, end - nextSpan);
        }
        return { start, end };
      });
    };

    // Native listener: React's synthetic wheel handler is passive, and we must
    // call preventDefault to stop the page from zooming.
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [maxMs, minMs]);

  /* ---- Pointer drag ------------------------------------------------- */

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      stopMomentum();
      event.currentTarget.setPointerCapture(event.pointerId);
      const at = msAtClientX(event.clientX);
      dragRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastMs: at,
        lastTime: performance.now(),
        velocity: 0,
      };
      emit(at);
    },
    [emit, msAtClientX, stopMomentum],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      const at = msAtClientX(event.clientX);
      const now = performance.now();
      const delta = now - drag.lastTime;
      if (delta > 0) {
        const velocity = (at - drag.lastMs) / delta;
        // Smooth the velocity so a single jittery frame cannot fling the handle.
        drag.velocity = drag.velocity * 0.6 + velocity * 0.4;
        drag.lastTime = now;
        drag.lastMs = at;
      }
      drag.lastX = event.clientX;
      emit(at);
    },
    [emit, msAtClientX],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      startMomentum(drag.velocity);
    },
    [startMomentum],
  );

  /* ---- Keyboard ----------------------------------------------------- */

  const eventTimes = useMemo(() => {
    const times: number[] = [];
    for (const marker of markers) {
      const at = toMs(marker.timestamp);
      if (at !== null) times.push(at);
    }
    times.sort((a, b) => a - b);
    return times;
  }, [markers]);

  const stepByEvent = useCallback(
    (direction: -1 | 1): void => {
      if (eventTimes.length === 0) {
        emit(valueRef.current + direction * HOUR_MS);
        return;
      }
      const target =
        direction === 1
          ? eventTimes.find((time) => time > valueRef.current + 1)
          : [...eventTimes].reverse().find((time) => time < valueRef.current - 1);
      if (target === undefined) {
        emit(direction === 1 ? maxMs : minMs);
        return;
      }
      valueRef.current = clamp(target, minMs, maxMs);
      onChange(iso(valueRef.current));
      onCommit?.(iso(valueRef.current));
    },
    [emit, eventTimes, maxMs, minMs, onChange, onCommit],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      switch (event.key) {
        case 'ArrowLeft':
          if (event.shiftKey) emit(valueRef.current - DAY_MS);
          else stepByEvent(-1);
          break;
        case 'ArrowRight':
          if (event.shiftKey) emit(valueRef.current + DAY_MS);
          else stepByEvent(1);
          break;
        case 'ArrowDown':
          emit(valueRef.current - DAY_MS);
          break;
        case 'ArrowUp':
          emit(valueRef.current + DAY_MS);
          break;
        case 'Home':
          emit(minMs);
          break;
        case 'End':
          emit(maxMs);
          break;
        case 'Enter':
        case ' ':
          onCommit?.(iso(valueRef.current));
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [emit, maxMs, minMs, onCommit, stepByEvent],
  );

  /* ---- Render ------------------------------------------------------- */

  if (loading) {
    return (
      <div className={cn('panel flex flex-col gap-2 p-3', className)} aria-busy="true">
        <span className="sr-only" role="status">
          Loading the timeline range
        </span>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }

  const selectedMarkerId = markers.find((marker) => toMs(marker.timestamp) === valueMs)?.id ?? null;
  const zoomed = windowRange.start > minMs || windowRange.end < maxMs;

  return (
    <section
      className={cn('panel flex flex-col gap-1.5 p-3', className)}
      aria-label="Timeline scrubber"
    >
      <TimelineMarkers
        markers={markers}
        min={iso(windowRange.start)}
        max={iso(windowRange.end)}
        selectedId={selectedMarkerId}
        onSelect={(marker) => {
          const at = toMs(marker.timestamp);
          if (at === null) return;
          const next = clamp(at, minMs, maxMs);
          valueRef.current = next;
          onChange(iso(next));
          onCommit?.(iso(next));
        }}
      />

      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-7 cursor-pointer touch-none select-none"
      >
        <div
          aria-hidden="true"
          className="timeline-track absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2"
        />

        {/* Progress fill: where the scrubber is relative to the window start. */}
        <div
          aria-hidden="true"
          className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-accent"
          style={{ left: 0, width: `${pct(valueMs)}%` }}
        />

        <div
          role="slider"
          tabIndex={0}
          aria-label="Timeline position"
          aria-orientation="horizontal"
          aria-valuemin={minMs}
          aria-valuemax={maxMs}
          aria-valuenow={Math.round(valueMs)}
          aria-valuetext={formatDate(valueMs)}
          onKeyDown={onKeyDown}
          style={{ left: `${pct(valueMs)}%` }}
          className={cn(
            'dur-fast ease-out-brand absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-bg-raised outline-none',
            'hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            dragRef.current !== null && 'scale-125',
          )}
        />

        <span className="text-micro absolute -top-0.5 left-0 text-text-subtle">
          {formatDate(windowRange.start, 'MMM d')}
        </span>
        <span className="text-micro absolute -top-0.5 right-0 text-text-subtle">
          {formatDate(windowRange.end, 'MMM d')}
        </span>
      </div>

      <p
        className="text-micro flex flex-wrap items-center gap-x-3 text-text-muted"
        aria-live="polite"
      >
        <span>
          position <span className="tabular text-text">{formatDate(valueMs)}</span>
        </span>
        <span className="text-text-subtle">{markers.length} events in range</span>
        <span className="text-text-subtle">Cmd/Ctrl + scroll to zoom</span>
      </p>

      {/* Range selector (Plan §15.6) - the same window, drivable from the keyboard. */}
      <div className="flex items-center gap-2">
        <CalendarRange aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        <label className="sr-only" htmlFor="timeline-window-start">
          Window start
        </label>
        <input
          id="timeline-window-start"
          type="range"
          min={minMs}
          max={maxMs}
          step={HOUR_MS}
          value={windowRange.start}
          onChange={(event) => {
            const next = Number(event.target.value);
            setWindowRange((previous) => ({
              start: Math.min(next, previous.end - MIN_SPAN_MS),
              end: previous.end,
            }));
          }}
          className="h-1 min-w-0 flex-1 accent-[var(--accent)]"
        />
        <label className="sr-only" htmlFor="timeline-window-end">
          Window end
        </label>
        <input
          id="timeline-window-end"
          type="range"
          min={minMs}
          max={maxMs}
          step={HOUR_MS}
          value={windowRange.end}
          onChange={(event) => {
            const next = Number(event.target.value);
            setWindowRange((previous) => ({
              start: previous.start,
              end: Math.max(next, previous.start + MIN_SPAN_MS),
            }));
          }}
          className="h-1 min-w-0 flex-1 accent-[var(--accent)]"
        />
        <IconButton
          size="sm"
          variant="ghost"
          icon={ZoomIn}
          label={zoomed ? 'Reset zoom to the full range' : 'Zoomed to full range'}
          disabled={!zoomed}
          onClick={() => setWindowRange({ start: minMs, end: maxMs })}
        />
      </div>
    </section>
  );
}
