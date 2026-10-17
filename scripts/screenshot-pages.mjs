#!/usr/bin/env node
/**
 * Captures a full-page screenshot of every workbench route.
 *
 * Navigation is a plain `page.goto` per route — no synthetic history events. A
 * `popstate` dispatch bypasses React Router's transition, which makes a lazy route
 * suspend during a synchronous update and fail with React error #426. A full load is
 * fine here because readiness is awaited explicitly rather than assumed.
 *
 * Three guards make a broken capture impossible to mistake for a good one:
 *   1. The document HTTP status is logged per route.
 *   2. Failed requests and 4xx/5xx responses are logged.
 *   3. A capture that matches the error boundary ("This page crashed") throws.
 *
 * Usage:
 *   node scripts/screenshot-pages.mjs
 *   node scripts/screenshot-pages.mjs --route /admin/users
 *   node scripts/screenshot-pages.mjs --route /orgs/<id>/settings
 *
 * Output: screenshots/<name>.png (git-ignored).
 */
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = 'https://ia-mscope.vercel.app';
const EMAIL = 'keninjavelas@gmail.com';

/**
 * The brief supplied the Atlas database password. The app password is the one the
 * account was created with, so it is tried first to spend a single attempt against
 * the login rate limiter.
 */
const CANDIDATES = ['AdminTest123!', 'Tbmi-741'];

const WIDTH = 1440;
const HEIGHT = 900;
const ORG_ID = '6ad30e6dcfb2ee8079bea812';

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'policies', path: '/policies' },
  { name: 'principals', path: '/principals' },
  { name: 'resources', path: '/resources' },
  { name: 'scenarios', path: '/scenarios' },
  { name: 'evaluate', path: '/evaluate' },
  { name: 'impact', path: '/impact' },
  // No readiness selector: the graph canvas only exists after the user runs a
  // traversal, so requiring it would fail a page that is rendering correctly.
  { name: 'graph', path: '/graph' },
  { name: 'timeline', path: '/timeline' },
  { name: 'audit', path: '/audit' },
  { name: 'admin-users', path: '/admin/users', ready: 'table thead th' },
  { name: 'org-settings', path: `/orgs/${ORG_ID}/settings` },
];

const OUT_DIR = join(process.cwd(), 'screenshots');

/** Error-boundary marker; a capture containing this is a failed capture. */
const CRASH_MARKER = 'This page crashed';

function parseRouteFilter(argv) {
  const index = argv.indexOf('--route');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined) throw new Error('--route requires a path, e.g. --route /admin/users');
  return value;
}

async function attemptLogin(page, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25_000 });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const routeFilter = parseRouteFilter(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  let failedRequests = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('requestfailed', (request) => {
    // errorText separates a real failure from `net::ERR_ABORTED`, which is what a
    // React Query cancellation looks like when a key changes mid-flight.
    const reason = request.failure()?.errorText ?? 'unknown';
    failedRequests.push(`FAILED ${new URL(request.url()).pathname} (${reason})`);
  });

  console.log(`Launching Chromium ${browser.version()} at ${WIDTH}x${HEIGHT}`);

  let loggedIn = false;
  for (const [index, candidate] of CANDIDATES.entries()) {
    loggedIn = await attemptLogin(page, candidate);
    console.log(`  login candidate #${index + 1}: ${loggedIn ? 'OK' : 'FAILED'}`);
    if (loggedIn) break;
  }

  if (!loggedIn) {
    console.error('Could not authenticate with any candidate password.');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  // Wait for a signed-in-only element before touching any route, otherwise the first
  // navigation can happen while /auth/me is still in flight and bounce to /login.
  await page
    .waitForSelector('a[href="/policies"]', { timeout: 25_000 })
    .catch(() => console.log('  ! sidebar did not appear; continuing anyway'));

  const targets =
    routeFilter === null ? ROUTES : ROUTES.filter((route) => route.path === routeFilter);

  if (targets.length === 0) {
    console.error(`No route matches ${routeFilter}`);
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const results = [];

  for (const route of targets) {
    failedRequests = [];
    let documentStatus = null;

    try {
      // The deployed API intermittently answers 502 (the Render origin flapping).
      // A 502 on /auth/me leaves the shell on "Loading page" forever, so a single
      // attempt would capture a skeleton and call it a success. Retry the load a
      // bounded number of times before failing the route.
      for (let attempt = 1; ; attempt += 1) {
        const response = await page.goto(`${BASE}${route.path}`, {
          waitUntil: 'networkidle',
          timeout: 30_000,
        });
        documentStatus = response === null ? null : response.status();

        try {
          await page.waitForSelector('main h1', { timeout: 10_000 });
          break;
        } catch (error) {
          const body = await page.locator('body').innerText();
          const transient = body.includes('Loading page') || (documentStatus ?? 0) >= 500;
          if (!transient || attempt >= 3) throw error;
          console.log(
            `    attempt ${attempt}: still loading (doc=${documentStatus}); retrying in 3s`,
          );
          await page.waitForTimeout(3000);
        }
      }
      await page
        .waitForFunction(() => document.querySelectorAll('.skeleton').length === 0, {
          timeout: 15_000,
        })
        .catch(() => {});

      if (route.ready !== undefined) {
        await page.waitForSelector(route.ready, { timeout: 15_000 });
      }

      const crashCount = await page.locator(`text=${CRASH_MARKER}`).count();
      if (crashCount > 0) {
        throw new Error(`rendered the React error boundary ("${CRASH_MARKER}")`);
      }

      // Grow the viewport to fit the inner scrolling container.
      const contentHeight = await page.evaluate(() => {
        const main = document.querySelector('main');
        return Math.max(
          document.documentElement.scrollHeight,
          main instanceof HTMLElement ? main.scrollHeight : 0,
          window.innerHeight,
        );
      });
      const targetHeight = Math.min(Math.max(HEIGHT, contentHeight + 80), 6000);
      await page.setViewportSize({ width: WIDTH, height: targetHeight });
      await page.waitForTimeout(350);

      const file = join(OUT_DIR, `${route.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const size = statSync(file).size;

      const finalPath = new URL(page.url()).pathname;
      const note = finalPath !== route.path ? ` (redirected to ${finalPath})` : '';
      const failedNote =
        failedRequests.length === 0 ? '' : ` failed=[${[...new Set(failedRequests)].join(', ')}]`;

      results.push({ name: route.name, size, ok: true });
      console.log(
        `  captured ${route.name.padEnd(13)} ${route.path.padEnd(50)} ${String(size).padStart(8)}B ` +
          `doc=${documentStatus}${note}${failedNote}`,
      );

      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    } catch (error) {
      results.push({ name: route.name, size: 0, ok: false });
      console.log(
        `  FAILED   ${route.name.padEnd(13)} ${route.path.padEnd(50)} doc=${documentStatus} -> ${error.message.split('\n')[0]}`,
      );
      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log('\nSummary');
  console.log(`  routes    : ${results.length}`);
  console.log(`  captured  : ${results.filter((entry) => entry.ok).length}`);
  console.log(`  failed    : ${failed.length}`);
  console.log(`  out dir   : ${OUT_DIR}`);
  if (consoleErrors.length > 0) {
    console.log(`  console errors: ${consoleErrors.length}`);
    for (const message of consoleErrors.slice(0, 8)) console.log(`    ! ${message.split('\n')[0]}`);
  }

  await browser.close();
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nSCREENSHOT RUN FAILED');
  console.error(error);
  process.exitCode = 1;
});
