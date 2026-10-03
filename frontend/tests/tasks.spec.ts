import { test, expect } from '@playwright/test';

test('register, create, recover from failed save, edit, reload, delete and logout', async ({
  page,
}) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Interview Tester');
  await page.getByLabel('Email address').fill(`interview-${id}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('StrongPassword!123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your tasks, in focus.' })).toBeVisible();
  await expect(page.getByText('A little space for your next big thing.')).toBeVisible();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('Interview task');
  await page.getByLabel('Description (optional)').fill('A real task persisted in MySQL.');
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'UNAVAILABLE',
          message: 'Temporary problem. Please try again.',
        }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary problem');
  await expect(page.getByLabel('Task title')).toHaveValue('Interview task');
  await page.unroute('**/api/tasks');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Interview task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Interview task', exact: true }).click();
  await page.getByLabel('Task title').fill('Updated interview task');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Updated interview task', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Complete Updated interview task', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reopen Updated interview task', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Updated interview task', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete Updated interview task', exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Updated interview task', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByText('Sign out', { exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/login$/);
});

test('task list errors offer retry and recover', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@taskflow.local');
  await page.getByLabel('Password', { exact: true }).fill('TaskflowDemo!2026');
  await page.route('**/api/tasks?**', (route) => route.abort());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('We couldn’t connect');
  await page.unroute('**/api/tasks?**');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Outline the next sprint', exact: true }),
  ).toBeVisible();
});

test('search, status filtering and clearing filters show database results', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@taskflow.local');
  await page.getByLabel('Password', { exact: true }).fill('TaskflowDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Outline the next sprint', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search tasks').fill('Outline the next sprint');
  await expect(
    page.getByRole('button', { name: 'Outline the next sprint', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review the dashboard designs', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Show completed', exact: true }).click();
  await expect(page.getByText('No tasks match just yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Outline the next sprint', exact: true }),
  ).toBeVisible();
});

test('losing the session redirects to login on the next protected request', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@taskflow.local');
  await page.getByLabel('Password', { exact: true }).fill('TaskflowDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Outline the next sprint', exact: true }),
  ).toBeVisible();
  await context.clearCookies();
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});
