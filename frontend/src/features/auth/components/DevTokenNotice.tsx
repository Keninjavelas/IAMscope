import type { JSX } from 'react';
import { Terminal } from 'lucide-react';
import { env } from '@/env';

export interface DevTokenNoticeProps {
  label: string;
  token: string | null | undefined;
  hint?: string | undefined;
}

/**
 * Email delivery lands in v2 (Plan §2.2), so in development the API hands the
 * single-use token straight back to the client. Shown ONLY outside production -
 * never render these in a deployed build.
 */
export function DevTokenNotice({ label, token, hint }: DevTokenNoticeProps): JSX.Element | null {
  if (env.isProd || !token) return null;

  return (
    <div className="flex flex-col gap-1 rounded-input border border-warn/40 bg-warn-subtle px-3 py-2">
      <p className="text-12 flex items-center gap-1.5 font-medium text-warn">
        <Terminal aria-hidden="true" className="size-3.5" />
        {label} (development only)
      </p>
      <code className="mono text-micro break-all text-text">{token}</code>
      {hint ? <p className="text-micro text-text-muted">{hint}</p> : null}
    </div>
  );
}
