/**
 * Live-region announcement bus (Plan §15.4).
 *
 * Lives in `lib/` rather than in a component file so that non-React modules (the
 * mutation hooks) can announce a result without importing the component tree.
 *
 *  - `announce`        -> polite; coalesced so SSE bursts do not chatter
 *  - `announceUrgent`  -> assertive; evaluation verdicts and escalation results
 */

type Listener = (message: string) => void;

const politeListeners = new Set<Listener>();
const urgentListeners = new Set<Listener>();

let lastPolite = { message: '', at: 0 };
let lastUrgent = { message: '', at: 0 };

/** Same message twice inside the window is dropped: screen readers repeat it. */
function shouldEmit(last: { message: string; at: number }, message: string): boolean {
  const now = Date.now();
  return !(message === last.message && now - last.at < 1500);
}

export function announce(message: string): void {
  if (!shouldEmit(lastPolite, message)) return;
  lastPolite = { message, at: Date.now() };
  for (const listener of politeListeners) listener(message);
}

export function announceUrgent(message: string): void {
  if (!shouldEmit(lastUrgent, message)) return;
  lastUrgent = { message, at: Date.now() };
  for (const listener of urgentListeners) listener(message);
}

export function subscribeAnnouncements(listener: Listener): () => void {
  politeListeners.add(listener);
  return () => politeListeners.delete(listener);
}

export function subscribeUrgent(listener: Listener): () => void {
  urgentListeners.add(listener);
  return () => urgentListeners.delete(listener);
}
