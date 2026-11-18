// Screenshots of every main screen at the design sizes, for a visual check.
// Opt-in: SHOTS_DIR=<folder> npx playwright test screenshots
import { expect, test, type Browser } from '@playwright/test';

const dir = process.env.SHOTS_DIR;
test.skip(!dir, 'Set SHOTS_DIR to take screenshots');

const API = 'http://localhost:4100/api';

async function staff(browser: Browser, email: string, path: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/staff');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  return page;
}

test('screens', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const { token } = await (await request.post(`${API}/auth/login`, { data: { email: 'admin@masaka.demo', password: 'demo1234' } })).json();
  await request.post(`${API}/dev/reset`, { headers: { Authorization: `Bearer ${token}` } });

  const reception = await staff(browser, 'reception@masaka.demo', '/staff/reception', 'staff-reception');
  await reception.getByLabel('Display name').fill('Aline');
  await reception.getByLabel('Phone (optional, for SMS)').fill('0788 123 456');
  await reception.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(reception.getByRole('link', { name: 'Open patient page' })).toBeVisible();
  await reception.screenshot({ path: `${dir}/staff-reception-result.png`, fullPage: true });
  const patientUrl = new URL((await reception.getByRole('link', { name: 'Open patient page' }).getAttribute('href'))!).pathname;

  await staff(browser, 'reception@masaka.demo', '/staff/queue', 'staff-queue-board');
  await staff(browser, 'reception@masaka.demo', '/staff/team', 'staff-team');
  const doctor = await staff(browser, 'claudine@masaka.demo', '/staff/my-queue', 'staff-my-queue');
  await doctor.getByRole('button', { name: /call next/i }).click();
  await expect(doctor.getByTestId('current-number')).toBeVisible();
  await doctor.screenshot({ path: `${dir}/staff-my-queue-called.png`, fullPage: true });
  await staff(browser, 'admin@masaka.demo', '/staff/analytics', 'staff-analytics');
  await staff(browser, 'admin@masaka.demo', '/staff/admin/sms-templates', 'staff-sms-templates');

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phone = await phoneCtx.newPage();
  await phone.goto(patientUrl);
  await expect(phone.locator('#ticket-number')).toBeVisible();
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: `${dir}/patient-waiting.png`, fullPage: true });

  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto('/tv/masaka');
  await expect(tv.getByTestId('now-calling')).toBeVisible();
  await tv.waitForTimeout(3000);
  await tv.screenshot({ path: `${dir}/tv.png` });
});
