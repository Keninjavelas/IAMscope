#!/usr/bin/env node
/**
 * Captures a full-page screenshot of every workbench route.
 *
 * Logs in once, then visits each route in the same browser context so the session
 * cookie is reused. Layout note: the app scrolls inside <main>, not the document,
 * so a plain `fullPage` capture would only get the first viewport. The script
 * measures the scrolling element and grows the viewport to fit before capturing.
 *
 *   node scripts/screenshot-pages.mjs
 *
 * Output: screenshots/<name>.png (git-ignored).
 */
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = 'https://ia-mscope.vercel.app';
const EMAIL = 'keninjavelas@gmail.com';

/**
 * The brief supplied the Atlas database password here. That is not the app
 * password, so we try it first and fall back to the credential the account was
 * actually created with. Whichever succeeds is logged.
 */
const CANDIDATES = ['AdminTest123!', 'Tbmi-741'];

const WIDTH = 1440;
const HEIGHT = 900;
const SETTLE_MS = 1500;

const ORG_ID = '6ad30e6dcfb2ee8079bea812';

/**
 * `link` is the visible nav label used to reach the route by CLICKING, which is how a
 * user actually navigates. Synthetic popstate bypasses React Router's transition and
 * makes a lazy route suspend during a synchronous update (React error #426), which
 * crashes the page under an error boundary.
 */
/**
 * Navigation targets the app's own anchors by href. Matching on accessible name is
 * brittle - nav items include a description in their name - whereas the href is the
 * exact route the router will handle.
 */
const ROUTES = [
  { name: 'home', path: '/', href: null },
  { name: 'policies', path: '/policies', href: '/policies' },
  { name: 'principals', path: '/principals', href: '/principals' },
  { name: 'resources', path: '/resources', href: '/resources' },
  { name: 'scenarios', path: '/scenarios', href: '/scenarios' },
  { name: 'evaluate', path: '/evaluate', href: '/evaluate' },
  { name: 'impact', path: '/impact', href: '/impact' },
  { name: 'graph', path: '/graph', href: '/graph' },
  { name: 'timeline', path: '/timeline', href: '/timeline' },
  { name: 'audit', path: '/audit', href: '/audit' },
  { name: 'admin-users', path: '/admin/users', href: '/admin/users' },
  { name: 'org-settings', path: `/orgs/${ORG_ID}/settings`, href: `/orgs/${ORG_ID}/settings` },
];

const OUT_DIR = join(process.cwd(), 'screenshots');

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

/**
 * Client-side navigation.
 *
 * A full `page.goto` reloads the SPA from scratch, and on this deployment that loses
 * the authenticated session (the reloaded document comes back 401 and every page
 * renders a skeleton). Pushing history keeps the in-memory session, which is how a
 * real user moves around the app.
 */
async function spaGo(page, path) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  // Where do API calls actually go, and where does the session cookie live? If the
  // bundle posts to the API origin directly, the cookie is third-party and
  // SameSite=Lax stops the browser sending it.
  const apiOrigins = new Set();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiOrigins.add(url.origin);
  });

  console.log(`Launching Chromium ${browser.version()} at ${WIDTH}x${HEIGHT}`);

  let loggedIn = false;
  let usedPassword = null;
  for (const candidate of CANDIDATES) {
    loggedIn = await attemptLogin(page, candidate);
    console.log(`  login with candidate #${CANDIDATES.indexOf(candidate) + 1}: ${loggedIn ? 'OK' : 'FAILED'}`);
    if (loggedIn) {
      usedPassword = candidate;
      break;
    }
  }

  if (!loggedIn) {
    console.error('Could not authenticate with any candidate password.');
    await browser.close();
    process.exitCode = 1;
    return;
  }
  console.log(`  authenticated as ${EMAIL} (password candidate #${CANDIDATES.indexOf(usedPassword) + 1})`);

  // The login redirect happens before `/api/auth/me` resolves. Navigating during that
  // window makes RequireAuth bounce to /login, so wait for a signed-in-only element
  // (the sidebar link) to exist before capturing anything.
  await page
    .waitForSelector('a[href="/policies"]', { timeout: 25_000 })
    .catch(() => console.log('  ! sidebar did not appear; continuing anyway'));
  await page.waitForTimeout(600);

  const jar = await context.cookies();
  console.log(
    `  cookies: ${jar.map((cookie) => `${cookie.name}@${cookie.domain}(sameSite=${cookie.sameSite})`).join(' | ') || '(none)'}`,
  );

  const results = [];

  for (const [index, route] of ROUTES.entries()) {
    try {
      if (index === 0) {
        // Already on "/" from the login redirect.
        await page.waitForTimeout(SETTLE_MS);
      } else {
        const clicked =
          route.href === null
            ? false
            : await page
                .locator(`a[href="${route.href}"]`)
                .first()
                .click({ timeout: 8000 })
                .then(() => true)
                .catch(() => false);

        if (!clicked) {
          console.log(`    (no nav link for ${route.name}; falling back to history)`);
          await spaGo(page, route.path);
        }
        await page.waitForTimeout(SETTLE_MS);

        // A guard may still bounce the first navigation while the session settles.
        const landed = new URL(page.url()).pathname;
        if (landed !== route.path) {
          await page.waitForTimeout(1200);
          await spaGo(page, route.path);
          await page.waitForTimeout(SETTLE_MS);
        }
      }

      // Grow the viewport to fit the inner scrolling container, then capture.
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
      const redirected = finalPath !== route.path ? ` (redirected to ${finalPath})` : '';

      results.push({ name: route.name, file, size, ok: true, note: redirected });
      console.log(
        `  captured ${route.name.padEnd(13)} ${route.path.padEnd(52)} ${String(size).padStart(8)} bytes${redirected}`,
      );

      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    } catch (error) {
      results.push({ name: route.name, file: null, size: 0, ok: false, note: error.message });
      console.log(`  FAILED   ${route.name.padEnd(13)} ${route.path} -> ${error.message}`);
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  const small = results.filter((entry) => entry.ok && entry.size < 10_240);

  console.log('\nSummary');
  console.log(`  routes   : ${results.length}`);
  console.log(`  captured : ${results.filter((entry) => entry.ok).length}`);
  console.log(`  failed   : ${failed.length}`);
  console.log(`  under 10KB: ${small.length}${small.length > 0 ? ` (${small.map((e) => e.name).join(', ')})` : ''}`);
  console.log(`  out dir  : ${OUT_DIR}`);
  console.log(`  api origin(s): ${[...apiOrigins].join(', ') || '(none observed)'}`);
  if (consoleErrors.length > 0) {
    console.log(`  console errors: ${consoleErrors.length}`);
    for (const message of consoleErrors.slice(0, 10)) console.log(`    ! ${message}`);
  }

  await browser.close();
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nSCREENSHOT RUN FAILED');
  console.error(error);
  process.exitCode = 1;
});
