import type { ReactNode, JSX } from 'react';
import { cn } from '@/lib/cn';

export interface AuthCardProps {
  title: string;
  description?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  className?: string | undefined;
}

/** The single card every auth screen is built on. */
export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: AuthCardProps): JSX.Element {
  return (
    <section
      className={cn('overlay-surface flex w-full max-w-[420px] flex-col gap-4 p-5', className)}
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold tracking-tight text-text">{title}</h1>
        {description ? <p className="text-13 text-text-muted">{description}</p> : null}
      </header>

      <div className="flex flex-col gap-3">{children}</div>

      {footer ? (
        <footer className="text-13 border-t border-border pt-3 text-text-muted">{footer}</footer>
      ) : null}
    </section>
  );
}
