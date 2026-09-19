import { useEffect, useRef, useState, type JSX } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, MailCheck, TriangleAlert } from 'lucide-react';
import { ROUTES } from '@/lib/constants';
import { useVerifyEmail } from '@/api/mutations/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from './components/AuthCard';
import { AuthLayout } from './components/AuthLayout';

type VerifyState = 'idle' | 'verifying' | 'verified' | 'failed';

export default function VerifyEmailPage(): JSX.Element {
  const [params] = useSearchParams();
  const verify = useVerifyEmail();
  const [state, setState] = useState<VerifyState>('idle');
  const [token, setToken] = useState(params.get('token') ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const autoRan = useRef(false);

  /** Auto-verify when the link carries a token, exactly once. */
  useEffect(() => {
    const fromUrl = params.get('token');
    if (fromUrl === null || autoRan.current) return;
    autoRan.current = true;
    setState('verifying');
    verify.mutate(
      { token: fromUrl },
      {
        onSuccess: () => setState('verified'),
        onError: (error) => {
          setState('failed');
          setMessage(error.message);
        },
      },
    );
  }, [params, verify]);

  const submit = (): void => {
    if (token.trim() === '') {
      setMessage('Paste the token from your verification email.');
      return;
    }
    setState('verifying');
    verify.mutate(
      { token: token.trim() },
      {
        onSuccess: () => setState('verified'),
        onError: (error) => {
          setState('failed');
          setMessage(error.message);
        },
      },
    );
  };

  return (
    <AuthLayout>
      <AuthCard
        title="Verify your email"
        description="Confirming the address keeps password resets and invitations working."
        footer={
          <span>
            <Link to={ROUTES.login} className="font-medium">
              Back to sign in
            </Link>
          </span>
        }
      >
        {state === 'verified' ? (
          <div className="flex flex-col gap-3">
            <p className="text-13 flex items-center gap-2 text-success" role="status">
              <BadgeCheck aria-hidden="true" className="size-4" />
              Your email address is verified.
            </p>
            <Button variant="primary" asChild className="w-fit">
              <Link to={ROUTES.home}>Continue to IAMScope</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {state === 'failed' ? (
              <p
                role="alert"
                className="text-meta flex items-start gap-1.5 rounded-input border border-danger/40 bg-danger-subtle px-2 py-1.5 text-danger"
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{message ?? 'That token is invalid or has expired.'}</span>
              </p>
            ) : (
              <p className="text-13 text-text-muted">
                Open the link in your verification email, or paste the token below. In local
                development the token is returned by the signup response.
              </p>
            )}

            <Input
              label="Verification token"
              className="mono"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste token"
              aria-label="Verification token"
            />

            <Button
              variant="primary"
              fullWidth
              iconLeft={MailCheck}
              loading={state === 'verifying'}
              onClick={submit}
            >
              Verify email
            </Button>
          </div>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
