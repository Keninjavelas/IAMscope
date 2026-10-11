import { useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { signupSchema, type SignupInput } from '@iamscope/schemas';
import { ROUTES } from '@/lib/constants';
import { isApiError } from '@/api/client';
import { useSignup } from '@/api/mutations/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from './components/AuthCard';
import { AuthLayout } from './components/AuthLayout';
import { DevTokenNotice } from './components/DevTokenNotice';

export default function SignupPage(): JSX.Element {
  const navigate = useNavigate();
  const signup = useSignup();
  const [verificationToken, setVerificationToken] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '', orgName: '' },
  });

  const onSubmit = form.handleSubmit((values: SignupInput) => {
    signup.mutate(values, {
      onSuccess: (result) => {
        const token = result.verificationToken ?? null;
        setVerificationToken(token);
        if (token) return;
        navigate(ROUTES.home, { replace: true });
      },
    });
  });

  const serverError = signup.error;

  return (
    <AuthLayout>
      <AuthCard
        title="Create your workbench"
        description="Signing up creates your user account and its first organization - you become the owner."
        footer={
          <span>
            Already have an account?{' '}
            <Link to={ROUTES.login} className="font-medium">
              Sign in
            </Link>
          </span>
        }
      >
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
          <Input
            label="Your name"
            type="text"
            autoComplete="name"
            autoFocus
            required
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />

          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />

          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            hint="At least 12 characters, and not a commonly breached one."
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />

          <Input
            label="Organization name"
            required
            hint="Shown in the org switcher. You can rename it later."
            error={form.formState.errors.orgName?.message}
            {...form.register('orgName')}
          />

          {serverError ? (
            <p
              role="alert"
              className="text-meta rounded-input border border-danger/40 bg-danger-subtle px-2 py-1.5 text-danger"
            >
              {isApiError(serverError) && serverError.fieldErrors.email
                ? serverError.fieldErrors.email
                : isApiError(serverError)
                  ? serverError.message
                  : 'Could not create your account.'}
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
            loading={signup.isPending}
            iconLeft={UserPlus}
          >
            Create account
          </Button>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
