import { useEffect, useState, type JSX } from 'react';
import { FlaskConical, Plus, Save } from 'lucide-react';
import { POLICY_EFFECTS, type PolicyEffect, type Scenario } from '@iamscope/types';
import { useCreateScenario, useUpdateScenario } from '@/api/mutations/scenarios';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PrincipalPicker } from '@/components/domain/PrincipalPicker';
import { ResourcePicker } from '@/components/domain/ResourcePicker';
import { usePolicies } from '@/api/queries/policies';
import { usePrincipals } from '@/api/queries/principals';
import { useResources } from '@/api/queries/resources';
import { useActiveOrgId } from '@/stores/session';
import { isFullWildcardAction } from '@/lib/iam';

const EFFECT_OPTIONS = POLICY_EFFECTS.map((effect) => ({ value: effect, label: effect }));

export interface ScenarioFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenario?: Scenario | null;
}

export function ScenarioFormDialog({
  open,
  onOpenChange,
  scenario = null,
}: ScenarioFormDialogProps): JSX.Element {
  const orgId = useActiveOrgId();
  const create = useCreateScenario();
  const update = useUpdateScenario();
  const isEdit = scenario !== null;

  const principals = usePrincipals(orgId, { pageSize: 200 });
  const resources = useResources(orgId, { pageSize: 200 });
  const policies = usePolicies(orgId, { pageSize: 200 });

  const [name, setName] = useState('');
  const [principalArn, setPrincipalArn] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [resourceArn, setResourceArn] = useState<string | null>(null);
  const [expected, setExpected] = useState<PolicyEffect>('Allow');
  const [tags, setTags] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setName(scenario?.name ?? '');
    setPrincipalArn(scenario?.principalArn ?? null);
    setAction(scenario?.action ?? '');
    setResourceArn(scenario?.resourceArn ?? null);
    setExpected(scenario?.expectedResult ?? 'Allow');
    setTags(scenario?.tags.join(', ') ?? '');
  }, [open, scenario]);

  // Validity is computed independently of `submitted`, so the guard inside
  // `submit` is correct on the very first click (state updates are async).
  const nameInvalid = name.trim() === '';
  const actionInvalid = action.trim() === '';
  const principalInvalid = principalArn === null;
  const resourceInvalid = resourceArn === null;

  const nameError = submitted && nameInvalid ? 'Name the scenario.' : null;
  const actionError =
    submitted && actionInvalid ? 'An action is required (e.g. s3:GetObject).' : null;
  const principalError = submitted && principalInvalid ? 'Pick the principal to test.' : null;
  const resourceError = submitted && resourceInvalid ? 'Pick the resource to test against.' : null;

  const submit = (): void => {
    setSubmitted(true);
    if (nameInvalid || actionInvalid || principalInvalid || resourceInvalid) return;

    const payload = {
      name: name.trim(),
      principalArn,
      action: action.trim(),
      resourceArn,
      expectedResult: expected,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
    };

    if (scenario) {
      update.mutate({ id: scenario.id, ...payload }, { onSuccess: () => onOpenChange(false) });
      return;
    }
    create.mutate(payload, { onSuccess: () => onOpenChange(false) });
  };

  const error = create.error ?? update.error;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={isEdit ? `Edit ${scenario.name}` : 'New scenario'}
      description="A scenario is a saved access question with the answer you expect. Evaluations compare the engine's verdict against it."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={isEdit ? Save : Plus}
            loading={create.isPending || update.isPending}
            onClick={submit}
          >
            {isEdit ? 'Save scenario' : 'Create scenario'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Name"
          autoFocus
          required
          value={name}
          error={nameError}
          placeholder="Analyst can read the reports bucket"
          onChange={(event) => setName(event.target.value)}
        />

        <PrincipalPicker
          value={principalArn}
          onChange={setPrincipalArn}
          principals={principals.data?.items ?? []}
          error={principalError}
        />

        <Input
          label="Action"
          required
          mono
          value={action}
          error={actionError}
          hint={
            isFullWildcardAction(action)
              ? 'The wildcard action tests the whole service - useful, but it hides which permission matters.'
              : 'Service:Operation, e.g. s3:GetObject.'
          }
          onChange={(event) => setAction(event.target.value)}
        />

        <ResourcePicker
          value={resourceArn}
          onChange={setResourceArn}
          resources={resources.data?.items ?? []}
          error={resourceError}
        />

        <Select
          label="Expected result"
          value={expected}
          options={EFFECT_OPTIONS}
          onValueChange={(value) => setExpected(value as PolicyEffect)}
        />

        <Input
          label="Tags"
          value={tags}
          hint="Comma separated. Used by the scenario filters."
          onChange={(event) => setTags(event.target.value)}
        />

        {error ? (
          <p role="alert" className="text-meta text-danger">
            {error.message}
          </p>
        ) : null}

        <p className="text-micro flex items-center gap-1.5 text-text-subtle">
          <FlaskConical aria-hidden="true" className="size-3" />
          {policies.data?.total ?? 0} policies and {resources.data?.total ?? 0} resources available
          to test.
        </p>
      </div>
    </Dialog>
  );
}
