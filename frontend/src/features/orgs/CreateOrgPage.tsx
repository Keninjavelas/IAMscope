import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2 } from 'lucide-react';
import { createOrgSchema, type CreateOrgInput } from '@iamscope/schemas';
import { isApiError } from '@/api/client';
import { useCreateOrg } from '@/api/mutations/orgs';
import { useSwitchOrg } from '@/api/mutations/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { ROUTES } from '@/lib/constants';

export default function CreateOrgPage(): JSX.Element {
  const navigate = useNavigate();
  const createOrg = useCreateOrg();
  const switchOrg = useSwitchOrg();

  const form = useForm({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: '', slug: '' },
  });

  const onSubmit = form.handleSubmit((values: CreateOrgInput) => {
    const payload: { name: string; slug?: string } = {
      name: values.name,
      ...(values.slug === undefined || values.slug === '' ? {} : { slug: values.slug }),
    };
    createOrg.mutate(payload, {
      onSuccess: (org) => {
        // Make the new tenant the active one before the shell re-renders.
        switchOrg.mutate({ orgId: org.id });
        navigate(ROUTES.home);
      },
    });
  });

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <PageHeader
        title="Create an organization"
        description="An organization is the tenant boundary: every policy, principal, scenario and audit event belongs to exactly one."
        breadcrumbs={[{ label: 'Organizations' }, { label: 'New' }]}
      />

      <form className="panel flex flex-col gap-3 p-4" onSubmit={onSubmit} noValidate>
        <Input
          label="Organization name"
          autoFocus
          required
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />

        <Input
          label="Slug"
          hint="Optional. Lowercase letters, numbers and single hyphens; used in URLs."
          error={form.formState.errors.slug?.message}
          {...form.register('slug')}
        />

        {createOrg.error ? (
          <p
            role="alert"
            className="text-meta rounded-input border border-danger/40 bg-danger-subtle px-2 py-1.5 text-danger"
          >
            {isApiError(createOrg.error)
              ? createOrg.error.message
              : 'Could not create the organization.'}
          </p>
        ) : null}

        <p className="text-micro text-text-subtle">
          You become the owner - the only role that can delete the organization.
        </p>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.home)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            iconLeft={Building2}
            loading={createOrg.isPending}
          >
            Create organization
          </Button>
        </div>
      </form>
    </div>
  );
}
