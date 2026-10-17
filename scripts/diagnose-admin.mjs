#!/usr/bin/env node
/**
 * One-off diagnostic for /admin/users.
 *
 * Answers three questions in order:
 *   1. Does the deployed backend report isPlatformAdmin=true for this account?
 *   2. Does a hard load of /admin/users stay on the route, or redirect to /?
 *   3. If it renders, does the table content actually appear?
 *
 *   node scripts/diagnose-admin.mjs
 */
import { chromium } from 'playwright';

const BASE = 'https://ia-mscope.vercel.app';
const EMAIL = 'keninjavelas@gmail.com';
const PASSWORD = 'AdminTest123!';

const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('console', (message) => console.log('CONSOLE:', message.type(), message.text()));
  page.on('response', (response) => {
    if (response.url().includes('/api/')) console.log('API:', response.status(), response.url());
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  // The form is label-associated; fall back to name/type selectors if that changes.
  const emailById = page.getByLabel('Email');
  if ((await emailById.count()) > 0) {
    await emailById.fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
  } else {
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
  }

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  console.log('Logged in, URL is now:', page.url());

  const me = await page.evaluate(() =>
    fetch('/api/auth/me', { credentials: 'include' }).then((response) => response.json()),
  );
  console.log('/auth/me body:', JSON.stringify(me, null, 2));

  await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' });
  console.log('After /admin/users, URL is now:', page.url());

  // Give the guard a moment to settle if it is still in its hydration state.
  await page.waitForTimeout(2500);
  console.log('URL after settle:', page.url());

  const bodyText = await page.locator('body').innerText();
  console.log('Page contains "Users":', bodyText.includes('Users'));
  console.log('Page contains "Suspend":', bodyText.includes('Suspend'));
  console.log('Page contains "No users":', bodyText.includes('No users'));
  console.log('Page contains "Checking access":', bodyText.includes('Checking access'));
  console.log('Page contains "crashed":', bodyText.includes('crashed'));
  console.log('--- first 600 chars of body ---');
  console.log(bodyText.slice(0, 600));
} finally {
  await browser.close();
}
