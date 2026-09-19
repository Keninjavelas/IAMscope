import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export interface NoOrgNoticeProps {
  title?: string;
  description?: string;
}

/** Shared empty state for every org-scoped page when no org is active. */
export function NoOrgNotice({
  title = 'No organization selected',
  description = 'Organization pages live inside a tenant. Create one, or switch to an existing one from the header.',
}: NoOrgNoticeProps): JSX.Element {
  return (
    <div className="panel">
      <EmptyState
        icon={Building2}
        title={title}
        description={description}
        action={
          <Button variant="primary" size="sm" asChild>
            <Link to="/orgs/new">Create organization</Link>
          </Button>
        }
      />
    </div>
  );
}
