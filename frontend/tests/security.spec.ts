import { test, expect } from '@playwright/test';

test('security headers protect SPA routes, assets, errors and API responses', async ({
  page,
  request,
}) => {
  const document = await page.goto('/login');
  const asset = await page.locator('script[src]').first().getAttribute('src');
  expect(asset).toBeTruthy();
  const responses = [
    document!,
    await request.get(asset!),
    await request.get('/assets/not-found-security.js'),
    await request.get('/api/health'),
  ];
  expect(responses.map((response) => response.status())).toEqual([200, 200, 404, 200]);
  for (const response of responses) {
    const headers = response.headers();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['permissions-policy']).toContain('camera=()');
  }
});

test('CSP blocks an injected inline script while the application remains usable', async ({
  page,
}) => {
  await page.goto('/login');
  const result = await page.evaluate(() => {
    const target = window as typeof window & { securityCspProbe?: number };
    target.securityCspProbe = 0;
    const script = document.createElement('script');
    script.textContent = 'window.securityCspProbe = 1';
    document.body.appendChild(script);
    return target.securityCspProbe;
  });
  expect(result).toBe(0);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('stored HTML payloads display as text without executable child elements', async ({ page }) => {
  const title = '<img src="/missing" onerror="window.securityXssProbe=1">';
  const description = '<svg onload="window.securityXssProbe=2"></svg>';
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Security Tester');
  await page
    .getByLabel('Email address')
    .fill(`security-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('StrongPassword!123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { securityXssProbe: number }).securityXssProbe = 0;
  });
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill(title);
  await page.getByLabel('Description (optional)').fill(description);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  const task = page.getByRole('button', { name: title, exact: true });
  await expect(task).toBeVisible();
  await expect(task.locator('img')).toHaveCount(0);
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as typeof window & { securityXssProbe: number }).securityXssProbe,
    ),
  ).toBe(0);
  await page.reload();
  await expect(task).toBeVisible();
  await expect(task.locator('img')).toHaveCount(0);
  await expect(page.locator('svg[onload]')).toHaveCount(0);
  await page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(task).toHaveCount(0);
});
