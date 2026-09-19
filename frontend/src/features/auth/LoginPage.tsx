import { useState, type JSX } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn } from 'lucide-react';
import { loginSchema, type LoginInput } from '@iamscope/schemas';
import { ROUTES } from '@/lib/constants';
import { isApiError } from '@/api/client';
import { useLogin } from '@/api/mutations/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from './components/AuthCard';
import { AuthLayout } from './components/AuthLayout';
import { DevTokenNotice } from './components/DevTokenNotice';

/** Only same-origin paths are honoured, so `?next=` cannot become an open redirect. */
export function safeNextPath(raw: string | null): string | null {
  if (raw === null || raw === '') return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const login = useLogin();
  const [verificationToken, setVerificationToken] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit((values: LoginInput) => {
    login.mutate(values, {
      onSuccess: (result) => {
        setVerificationToken(result.verificationToken ?? null);
        navigate(next ?? ROUTES.home, { replace: true });
      },
    });
  });

  const serverError = login.error;

  return (
    <AuthLayout>
      <AuthCard
        title="Sign in"
        description="Use the email and password you signed up with."
        footer={
          <span className="flex flex-col gap-1">
            <span>
              No account?{' '}
              <Link to={ROUTES.signup} className="font-medium">
                Create one
              </Link>
            </span>
            <Link to={ROUTES.forgotPassword}>Forgot your password?</Link>
          </span>
        }
      >
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

          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />

          {serverError ? (
            <p
              role="alert"
              className="text-meta rounded-input border border-danger/40 bg-danger-subtle px-2 py-1.5 text-danger"
            >
              {isApiError(serverError)
                ? serverError.isRateLimited
                  ? 'Too many attempts. Wait a few minutes and try again.'
                  : serverError.message
                : 'Could not sign in.'}
            </p>
          ) : null}

          <DevTokenNotice
            label="Email verification token"
            token={verificationToken}
            hint="Open Verify email and paste this token to confirm the address."
          />

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={login.isPending}
            iconLeft={LogIn}
          >
            Sign in
          </Button>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
