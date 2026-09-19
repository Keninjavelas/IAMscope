import { useEffect, useState, type JSX } from 'react';
import { subscribeAnnouncements, subscribeUrgent } from '@/lib/announcer';

/**
 * Two live regions, mounted once in `App.tsx`.
 *
 *  - polite: SSE-driven "policy updated" chatter, coalesced by `announce()`
 *  - assertive: evaluation verdicts and escalation results
 *
 * Both regions are visually hidden but never `display: none`, which would stop
 * assistive tech from reading them.
 */
export function ARIAAnnouncer(): JSX.Element {
  const [polite, setPolite] = useState('');
  const [urgent, setUrgent] = useState('');

  useEffect(() => subscribeAnnouncements(setPolite), []);
  useEffect(() => subscribeUrgent(setUrgent), []);

  return (
    <div className="sr-only">
      <div role="status" aria-live="polite" aria-atomic="true" data-announcer="polite">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-announcer="assertive">
        {urgent}
      </div>
    </div>
  );
}

export { announce, announceUrgent, subscribeAnnouncements, subscribeUrgent } from '@/lib/announcer';
