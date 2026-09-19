import type { JSX } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { resetPasswordSchema } from '@iamscope/schemas';
import { ROUTES } from '@/lib/constants';
import { useResetPassword } from '@/api/mutations/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from './components/AuthCard';
import { AuthLayout } from './components/AuthLayout';

/** The shared schema plus the confirmation field, so zod owns every message. */
const resetFormSchema = resetPasswordSchema
  .extend({ confirmPassword: z.string().min(1, 'Confirm your new password') })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

export default function ResetPasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reset = useResetPassword();

  const tokenFromUrl = params.get('token') ?? '';

  const form = useForm({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { token: tokenFromUrl, newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    reset.mutate(
      { token: values.token, newPassword: values.newPassword },
      { onSuccess: () => navigate(ROUTES.login, { replace: true }) },
    );
  });

  return (
    <AuthLayout>
      <AuthCard
        title="Choose a new password"
        description="Setting a new password rotates every other session on your account."
        footer={
          <span>
            <Link to={ROUTES.login} className="font-medium">
              Back to sign in
            </Link>
          </span>
        }
      >
        <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
          {tokenFromUrl === '' ? (
            <Input
              label="Reset token"
              autoFocus
              required
              className="mono"
              hint="Paste the token from the reset email."
              error={form.formState.errors.token?.message}
              {...form.register('token')}
            />
          ) : (
            <input type="hidden" {...form.register('token')} />
          )}

          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            hint="At least 12 characters."
            error={form.formState.errors.newPassword?.message}
            {...form.register('newPassword')}
          />

          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            error={form.formState.errors.confirmPassword?.message}
            {...form.register('confirmPassword')}
          />

          {reset.error ? (
            <p
              role="alert"
              className="text-meta rounded-input border border-danger/40 bg-danger-subtle px-2 py-1.5 text-danger"
            >
              {reset.error.message}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={reset.isPending}
            iconLeft={ShieldCheck}
          >
            Set new password
          </Button>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
