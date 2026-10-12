import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EvaluationDiff } from '@iamscope/types';
import { DiffTable } from './DiffTable';

vi.mock('@/components/ui/JsonDiff', () => ({
  JsonDiff: ({ mode }: { mode: string }) => <div data-testid="impact-json-diff" data-mode={mode} />,
}));

describe('Impact scenario detail', () => {
  it('passes word mode to the decision trace JSON diff', async () => {
    const diff: EvaluationDiff = {
      before: null,
      after: {
        id: 'run-2',
        label: 'After',
        snapshotAt: '2026-10-12T00:00:00.000Z',
        triggeredBy: 'manual',
        triggeredByName: null,
        summary: { total: 1, passed: 1, failed: 0 },
        createdAt: '2026-10-12T00:00:00.000Z',
      },
      counts: {
        total: 1,
        changed: 1,
        allowToDeny: 1,
        denyToAllow: 0,
        unchanged: 0,
        added: 0,
        removed: 0,
      },
      entries: [
        {
          scenarioId: 'scenario-1',
          scenarioName: 'Scenario One',
          principalArn: 'arn:aws:iam::123456789012:user/alice',
          action: 's3:GetObject',
          resourceArn: 'arn:aws:s3:::bucket/object',
          before: 'Allow',
          after: 'Deny',
          transition: 'allow-to-deny',
          beforeTrace: [],
          afterTrace: [],
          removedStatements: [],
          addedStatements: [],
        },
      ],
    };

    render(<DiffTable diff={diff} />);
    await userEvent.click(screen.getByRole('button', { name: 'Explain Scenario One' }));

    expect(screen.getByTestId('impact-json-diff')).toHaveAttribute('data-mode', 'word');
  });
});
