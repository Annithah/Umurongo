// The pilot's core journey across four screens:
// reception registers a walk-in -> the patient page shows the position -> the doctor calls next
// -> the patient page and the waiting-room TV show the call.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { en, rw } from '@umurongo/shared';

const API = 'http://localhost:4100/api';

async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/staff');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  return page;
}

test.beforeEach(async ({ request }) => {
  // Fresh demo data: OPD has 4 patients waiting, so the new walk-in is OPD-024 with 4 ahead.
  const login = await request.post(`${API}/auth/login`, { data: { email: 'admin@masaka.demo', password: 'demo1234' } });
  expect(login.ok()).toBe(true);
  const { token } = await login.json();
  const reset = await request.post(`${API}/dev/reset`, { headers: { Authorization: `Bearer ${token}` } });
  expect(reset.ok()).toBe(true);
});

test('walk-in to call: reception, patient phone, doctor and TV stay in step', async ({ browser }) => {
  // 1. Reception registers Aline.
  const reception = await signIn(browser, 'reception@masaka.demo');
  await expect(reception).toHaveURL(/\/staff\/reception$/);
  await reception.getByLabel('Display name').fill('Aline');
  await reception.getByLabel('Phone (optional, for SMS)').fill('0788 123 456');
  await reception.getByRole('radio', { name: /General consultation/ }).click();
  await reception.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(reception.getByText('OPD-024', { exact: true }).first()).toBeVisible();
  const patientUrl = await reception.getByRole('link', { name: 'Open patient page' }).getAttribute('href');
  expect(patientUrl).toMatch(/\/t\/[A-Za-z0-9_-]{22}$/);

  // 2. The patient opens the link on a phone: Kinyarwanda, number, 4 people ahead.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(new URL(patientUrl!).pathname);
  await expect(phone.locator('#ticket-number')).toHaveText('OPD-024');
  await expect(phone.getByText(rw.ticket.status.CHECKED_IN)).toBeVisible();
  const ahead = phone.locator('[data-state="waiting"] p.font-heading').first();
  await expect(ahead).toHaveText('4');
  // No phone number anywhere on the patient page.
  await expect(phone.locator('body')).not.toContainText('0788');

  // The waiting-room TV.
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage();
  await tv.goto('/tv');
  await expect(tv).toHaveURL(/\/tv\/masaka$/);
  await expect(tv.getByTestId('now-calling')).toBeVisible();

  // 3. Dr. Uwase calls next until it is the new patient's turn. The phone updates live on the way.
  const doctor = await signIn(browser, 'claudine@masaka.demo');
  await expect(doctor).toHaveURL(/\/staff\/my-queue$/);
  const current = doctor.getByTestId('current-number');
  for (let i = 0; i < 8; i++) {
    if ((await current.count()) && (await current.innerText()) === 'OPD-024') break;
    const start = doctor.getByRole('button', { name: 'Start', exact: true });
    if (await start.isVisible()) {
      await start.click();
      await expect(doctor.getByRole('button', { name: /Finish and call next/ })).toBeEnabled();
    }
    const before = (await current.count()) ? await current.innerText() : '';
    await doctor.getByRole('button', { name: /call next/i }).click();
    await expect(current).not.toHaveText(before);
    if (i === 0) await expect(ahead).toHaveText('3'); // live, without reloading the phone
  }
  await expect(current).toHaveText('OPD-024');

  // 4. The phone shows the full-screen call with the room; the TV shows the number.
  const overlay = phone.getByRole('alertdialog');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText(rw.ticket.goToRoom('Room 3'))).toBeVisible();
  await expect(tv.getByTestId('now-calling')).toHaveText('OPD-024');
  await expect(tv.getByText('Room 3').first()).toBeVisible();
  // The TV never shows patient names.
  await expect(tv.locator('body')).not.toContainText('Aline');

  // English on the phone works too.
  await overlay.getByRole('button', { name: rw.ticket.imGoing }).click();
  await phone.getByRole('button', { name: 'English' }).click();
  await expect(phone.getByText(en.ticket.goToRoom('Room 3'))).toBeVisible();
});
