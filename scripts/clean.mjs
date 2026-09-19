// Cross-platform `npm run clean`.
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  'packages/types/dist',
  'packages/schemas/dist',
  'packages/tokens/dist',
  'backend/dist',
  'frontend/dist',
  'coverage',
  'backend/coverage',
  'frontend/coverage',
  'backend/tsconfig.tsbuildinfo',
  'frontend/tsconfig.tsbuildinfo',
];

for (const target of targets) {
  const absolute = path.join(root, target);
  if (!existsSync(absolute)) continue;
  await rm(absolute, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
