import { useEffect, useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Trash2 } from 'lucide-react';
import { DENSITY, ACCENTS, type Accent } from '@iamscope/tokens';
import { DENSITY_MODES, THEME_MODES, type DensityMode, type ThemeMode } from '@iamscope/types';
import { useDeleteOrg, useUpdateOrg } from '@/api/mutations/orgs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useActiveOrg, useRole } from '@/stores/session';
import { ROLE_LABELS } from '@/lib/constants';
import { NoOrgNotice } from './components/NoOrgNotice';

const DENSITY_OPTIONS = DENSITY_MODES.map((mode) => ({ value: mode, label: DENSITY[mode].label }));
const THEME_OPTIONS = THEME_MODES.map((mode) => ({
  value: mode,
  label: mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light',
}));
const ACCENT_OPTIONS = ACCENTS.map((accent) => ({ value: accent, label: accent }));

export default function OrgSettingsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeOrg = useActiveOrg();
  const role = useRole();
  const updateOrg = useUpdateOrg();
  const deleteOrg = useDeleteOrg();

  const [name, setName] = useState('');
  const [defaultDensity, setDefaultDensity] = useState<DensityMode>('compact');
  const [defaultTheme, setDefaultTheme] = useState<ThemeMode>('dark');
  const [accent, setAccent] = useState<Accent>('blue');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const orgId = params.id ?? activeOrg?.id ?? null;

  useEffect(() => {
    if (activeOrg?.id !== orgId) return;
    setName(activeOrg.name);
    setDefaultDensity(activeOrg.settings.defaultDensity);
    setDefaultTheme(activeOrg.settings.defaultTheme);
    setAccent(activeOrg.settings.accent as Accent);
  }, [activeOrg, orgId]);

  if (orgId === null) return <NoOrgNotice />;

  if (activeOrg?.id !== orgId) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-48 w-full rounded-panel" />
      </div>
    );
  }

  const isOwner = role === 'owner';
  const dirty =
    name !== activeOrg.name ||
    defaultDensity !== activeOrg.settings.defaultDensity ||
    defaultTheme !== activeOrg.settings.defaultTheme ||
    accent !== (activeOrg.settings.accent as Accent);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Organization settings"
        description="Defaults applied to new sessions in this organization. Your personal appearance overrides live in the header menu."
        breadcrumbs={[{ label: activeOrg.name }, { label: 'Settings' }]}
        actions={
          <>
            <Badge variant="muted" hideIcon>
              {role ? ROLE_LABELS[role] : 'No role'}
            </Badge>
            <Button
              variant="primary"
              size="sm"
              iconLeft={Save}
              loading={updateOrg.isPending}
              disabled={!dirty}
              onClick={() =>
                updateOrg.mutate({
                  name: name.trim(),
                  settings: { defaultDensity, defaultTheme, accent },
                })
              }
            >
              Save changes
            </Button>
          </>
        }
      />

      {updateOrg.error ? <ErrorState error={updateOrg.error} compact /> : null}

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="text-12 font-semibold tracking-wide text-text-subtle uppercase">Identity</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <Input label="Slug" value={activeOrg.slug} readOnly hint="Slugs are permanent." />
        </div>
        <p className="text-micro text-text-subtle">
          Organization ID <span className="mono">{activeOrg.id}</span>
        </p>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="text-12 font-semibold tracking-wide text-text-subtle uppercase">Defaults</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Default density"
            value={defaultDensity}
            options={DENSITY_OPTIONS}
            onValueChange={(value) => setDefaultDensity(value as DensityMode)}
          />
          <Select
            label="Default theme"
            value={defaultTheme}
            options={THEME_OPTIONS}
            onValueChange={(value) => setDefaultTheme(value as ThemeMode)}
          />
          <Select
            label="Accent"
            value={accent}
            options={ACCENT_OPTIONS}
            onValueChange={(value) => setAccent(value as Accent)}
          />
        </div>
      </section>

      <section className="panel flex flex-col gap-3 border-danger/40 p-4">
        <h2 className="text-12 font-semibold tracking-wide text-danger uppercase">Danger zone</h2>
        <p className="text-13 text-text-muted">
          Deleting the organization removes every policy, principal, scenario and audit event it
          owns. Only the owner can do this, and it cannot be undone.
        </p>
        <Button
          variant="danger"
          size="sm"
          iconLeft={Trash2}
          className="w-fit"
          disabled={!isOwner}
          title={isOwner ? undefined : 'Only the owner can delete an organization'}
          onClick={() => setConfirmDelete(true)}
        >
          Delete organization
        </Button>
      </section>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        size="sm"
        title={`Delete ${activeOrg.name}?`}
        description="This permanently removes the tenant and everything inside it."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleteOrg.isPending}
              onClick={() =>
                deleteOrg.mutate(activeOrg.id, {
                  onSuccess: () => navigate('/'),
                })
              }
            >
              Delete forever
            </Button>
          </>
        }
      >
        <p className="text-13 text-text-muted">
          Type nothing, read this twice: there is no restore path for an organization. Consider
          deleting the individual policies instead.
        </p>
      </Dialog>
    </div>
  );
}
