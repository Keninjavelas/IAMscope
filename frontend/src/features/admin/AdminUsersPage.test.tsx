import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX, ReactNode } from 'react';
import type { Paginated } from '@iamscope/types';

/* ------------------------------------------------------------------ */
/* Mocks                                                              */
/* ------------------------------------------------------------------ */

const getMock = vi.fn();
const patchMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/api/client', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
  isApiError: (error: unknown): error is { message: string } =>
    typeof error === 'object' && error !== null && 'message' in error,
}));

/** Flipped per test: the guard reads this selector. */
const session = vi.hoisted(() => ({ isPlatformAdmin: true }));

vi.mock('@/stores/session', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'demo@iamscope.dev', ...session }),
  // The guard waits for hydration before deciding; tests render a settled session.
  useSessionHydrated: () => true,
}));

// Imported after the mocks so the module graph picks them up.
const { default: AdminUsersPage } = await import('./AdminUsersPage');
const { default: RequirePlatformAdmin } = await import('./RequirePlatformAdmin');

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const USERS: Paginated<{
  id: string;
  email: string;
  name: string;
  status: 'active' | 'suspended' | 'deleted';
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orgs: { orgId: string; orgName: string; role: string }[];
}> = {
  items: [
    {
      id: 'u1',
      email: 'demo@iamscope.dev',
      name: 'Demo',
      status: 'active',
      emailVerified: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      lastLoginAt: '2026-10-16T12:00:00.000Z',
      orgs: [{ orgId: 'o1', orgName: 'Acme Cloud', role: 'owner' }],
    },
    {
      id: 'u2',
      email: 'analyst@iamscope.dev',
      name: 'Analyst',
      status: 'suspended',
      emailVerified: true,
      createdAt: '2026-10-02T00:00:00.000Z',
      lastLoginAt: null,
      orgs: [{ orgId: 'o1', orgName: 'Acme Cloud', role: 'member' }],
    },
    {
      id: 'u3',
      email: 'contractor@iamscope.dev',
      name: 'Contractor',
      status: 'active',
      emailVerified: false,
      createdAt: '2026-10-03T00:00:00.000Z',
      lastLoginAt: null,
      orgs: [],
    },
  ],
  total: 3,
  page: 1,
  pageSize: 50,
  hasMore: false,
};

function withProviders(ui: ReactNode): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/users']}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe('admin users page', () => {
  beforeEach(() => {
    session.isPlatformAdmin = true;
    getMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    getMock.mockResolvedValue(USERS);
  });

  it('F1: renders the table and per-row actions for a platform admin', async () => {
    render(withProviders(<AdminUsersPage />));

    // All seven columns are present.
    for (const heading of ['Email', 'Name', 'Status', 'Orgs', 'Created', 'Last login', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy();
    }

    // Three data rows, each showing its email.
    await waitFor(() => {
      expect(screen.getByText('demo@iamscope.dev')).toBeTruthy();
    });
    expect(screen.getByText('analyst@iamscope.dev')).toBeTruthy();
    expect(screen.getByText('contractor@iamscope.dev')).toBeTruthy();

    // 1 header row + 3 body rows.
    expect(screen.getAllByRole('row')).toHaveLength(4);

    // Actions follow status: two active rows offer Suspend, the suspended one Unsuspend,
    // and every row offers Delete.
    expect(screen.getAllByRole('button', { name: 'Suspend' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Unsuspend' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(3);

    // The suspend mutation is wired to the endpoint, not a local state flip.
    screen.getAllByRole('button', { name: 'Suspend' })[0]?.click();
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/admin/users/u1/status', { status: 'suspended' });
    });
  });

  it('F2: RequirePlatformAdmin redirects a non-admin away from the page', async () => {
    session.isPlatformAdmin = false;

    render(
      withProviders(
        <Routes>
          <Route path="/" element={<div>home route</div>} />
          <Route
            path="/admin/users"
            element={
              <RequirePlatformAdmin>
                <AdminUsersPage />
              </RequirePlatformAdmin>
            }
          />
        </Routes>,
      ),
    );

    // The redirect lands on /, and the page never renders.
    await waitFor(() => {
      expect(screen.getByText('home route')).toBeTruthy();
    });
    expect(screen.queryByRole('columnheader', { name: 'Email' })).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });
});
