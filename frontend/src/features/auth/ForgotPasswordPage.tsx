import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@iamscope/schemas';
import { ROUTES } from '@/lib/constants';
import { useForgotPassword } from '@/api/mutations/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from './components/AuthCard';
import { AuthLayout } from './components/AuthLayout';
import { DevTokenNotice } from './components/DevTokenNotice';

export default function ForgotPasswordPage(): JSX.Element {
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit((values: ForgotPasswordInput) => {
    forgot.mutate(values, {
      onSuccess: (result) => {
        setSentTo(values.email);
        setResetToken(result.resetToken ?? null);
      },
    });
  });

  return (
    <AuthLayout>
      <AuthCard
        title="Reset your password"
        description="We will email you a single-use link. The response is identical whether or not the address exists - that is deliberate."
        footer={
          <span>
            Remembered it?{' '}
            <Link to={ROUTES.login} className="font-medium">
              Back to sign in
            </Link>
          </span>
        }
      >
        {sentTo === null ? (
          <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              error={form.formState.errors.email?.message}
              {...form.register('email')}
            />

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={forgot.isPending}
              iconLeft={KeyRound}
            >
              Send reset link
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-13 rounded-input border border-border bg-bg-inset px-3 py-2 text-text-muted">
              If <span className="text-text">{sentTo}</span> has an account, a reset link is on its
              way. It expires soon, so use it now.
            </p>

            <DevTokenNotice
              label="Password reset token"
              token={resetToken}
              hint="Paste it on the reset page together with a new password."
            />

            {resetToken ? (
              <Button variant="secondary" size="sm" asChild className="w-fit">
                <Link to={`${ROUTES.resetPassword}?token=${encodeURIComponent(resetToken)}`}>
                  Open the reset form
                </Link>
              </Button>
            ) : null}

            <Button variant="ghost" size="sm" onClick={() => setSentTo(null)} className="w-fit">
              Use a different address
            </Button>
          </div>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
