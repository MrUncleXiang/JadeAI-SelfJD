import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100';
const ADMIN_USERNAME = 'e2e-admin';
const ADMIN_PASSWORD = 'E2E-Admin-Password-2026!';
const USER_PASSWORD = 'E2E-User-Password-2026!';

interface JsonResponse<T> {
  status: number;
  body: T | null;
}

interface AdminUser {
  id: string;
  username: string | null;
  role: 'admin' | 'user';
  status: 'active' | 'disabled' | 'pending';
}

interface AdminUserList {
  items: AdminUser[];
  total: number;
}

interface Invitation {
  code: string;
}

interface ResumeRecord {
  id: string;
  title: string;
}

function uniqueUsername(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

async function installStableBrowserState(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem('jade_tour_dashboard_completed', '1');
    localStorage.setItem('jade_tour_templates_completed', '1');
    localStorage.setItem('jade_tour_editor_completed', '1');
  });
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await installStableBrowserState(context);
  return context;
}

async function browserJson<T>(
  page: Page,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET',
  payload?: unknown,
): Promise<JsonResponse<T>> {
  const result = await page.evaluate(async ({ requestPath, requestMethod, requestPayload }) => {
    const response = await fetch(requestPath, {
      method: requestMethod,
      credentials: 'same-origin',
      headers: requestPayload === undefined ? undefined : { 'content-type': 'application/json' },
      body: requestPayload === undefined ? undefined : JSON.stringify(requestPayload),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  }, {
    requestPath: path,
    requestMethod: method,
    requestPayload: payload,
  });
  return result as JsonResponse<T>;
}

async function expectDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/en\/dashboard(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'My Resumes' })).toBeVisible();
}

async function login(page: Page, identifier: string, password: string): Promise<void> {
  await page.goto('/en/login');
  await page.locator('#identifier').fill(identifier);
  await page.locator('#password').fill(password);
  await Promise.all([
    page.waitForURL(/\/en\/dashboard(?:\?.*)?$/),
    page.getByRole('button', { name: 'Log in' }).click(),
  ]);
  await expectDashboard(page);
}

async function register(
  page: Page,
  username: string,
  invitationCode?: string,
): Promise<void> {
  await page.goto('/en/register');
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('#username').fill(username);
  await page.locator('#displayName').fill(`Display ${username}`);
  await page.locator('#email').fill(`${username}@example.test`);
  if (invitationCode) {
    await page.locator('#invitationCode').fill(invitationCode);
  }
  await page.locator('#password').fill(USER_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/en\/dashboard(?:\?.*)?$/),
    page.getByRole('button', { name: 'Register' }).click(),
  ]);
  await expectDashboard(page);
}

async function logoutViaUi(page: Page): Promise<void> {
  await expect(page.locator('header [data-slot="avatar"]')).toBeVisible();
  await page.locator('header [data-slot="avatar"]').click();
  const logoutItem = page.getByRole('menuitem', { name: 'Log out' });
  await expect(logoutItem).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => (
      response.url().endsWith('/api/auth/logout')
      && response.request().method() === 'POST'
    )),
    logoutItem.click(),
  ]);
  await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(401);
}

async function setRegistrationMode(
  page: Page,
  mode: 'closed' | 'invite' | 'open',
): Promise<void> {
  const result = await browserJson<{ mode: string }>(
    page,
    '/api/admin/registration',
    'PATCH',
    { mode },
  );
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ mode });
}

async function listUsers(page: Page): Promise<AdminUserList> {
  const result = await browserJson<AdminUserList>(
    page,
    '/api/admin/users?page=1&pageSize=100',
  );
  expect(result.status).toBe(200);
  expect(result.body).not.toBeNull();
  return result.body as AdminUserList;
}

function findUser(users: AdminUserList, username: string): AdminUser {
  const user = users.items.find((item) => item.username === username);
  expect(user, `Expected admin user list to contain ${username}`).toBeDefined();
  return user as AdminUser;
}

test.beforeEach(async ({ context }) => {
  await installStableBrowserState(context);
});

test('registration, invitation, login, logout, CSRF, and last-admin lifecycle', async ({ page }) => {
  const openUser = uniqueUsername('open-user');
  const invitedUser = uniqueUsername('invite-user');

  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/login\?callbackUrl=%2Fen%2Fdashboard$/);

  await page.goto('/en/register');
  await expect(page.getByText('Self-registration is closed.')).toBeVisible();

  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await setRegistrationMode(page, 'open');
  await logoutViaUi(page);

  await register(page, openUser);
  await logoutViaUi(page);

  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await setRegistrationMode(page, 'invite');
  const invitationResult = await browserJson<Invitation>(
    page,
    '/api/admin/invitations',
    'POST',
    { maxUses: 1, expiresInDays: 7 },
  );
  expect(invitationResult.status).toBe(201);
  expect(invitationResult.body?.code).toEqual(expect.any(String));
  const invitationCode = invitationResult.body?.code;
  expect(invitationCode).toBeTruthy();
  await logoutViaUi(page);

  await register(page, invitedUser, invitationCode);
  await logoutViaUi(page);

  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  const users = await listUsers(page);
  const admin = findUser(users, ADMIN_USERNAME);
  const openRegistrationUser = findUser(users, openUser);
  expect(findUser(users, invitedUser).status).toBe('active');

  const csrfResponse = await page.request.patch('/api/admin/registration', {
    headers: { origin: 'https://evil.example' },
    data: { mode: 'open' },
  });
  expect(csrfResponse.status()).toBe(403);
  await expect(csrfResponse.json()).resolves.toMatchObject({ code: 'UNTRUSTED_ORIGIN' });

  const lastAdminResult = await browserJson<{ code: string }>(
    page,
    `/api/admin/users/${admin.id}`,
    'PATCH',
    { status: 'disabled' },
  );
  expect(lastAdminResult.status).toBe(409);
  expect(lastAdminResult.body).toMatchObject({ code: 'LAST_ADMIN' });

  const disableResult = await browserJson<AdminUser>(
    page,
    `/api/admin/users/${openRegistrationUser.id}`,
    'PATCH',
    { status: 'disabled' },
  );
  expect(disableResult.status).toBe(200);
  expect(disableResult.body).toMatchObject({ username: openUser, status: 'disabled' });
  await logoutViaUi(page);

  await page.goto('/en/login');
  await page.locator('#identifier').fill(openUser);
  await page.locator('#password').fill(USER_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('form [role="alert"]')).toContainText(
    'The username, email, or password is incorrect',
  );
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('disabling a user invalidates an already issued session', async ({ browser }) => {
  const username = uniqueUsername('session-user');
  const adminContext = await newContext(browser);
  const userContext = await newContext(browser);
  const adminPage = await adminContext.newPage();
  const userPage = await userContext.newPage();

  try {
    await login(adminPage, ADMIN_USERNAME, ADMIN_PASSWORD);
    await setRegistrationMode(adminPage, 'open');
    await register(userPage, username);

    const before = await userPage.request.get('/api/me');
    expect(before.status()).toBe(200);

    const user = findUser(await listUsers(adminPage), username);
    const disableResult = await browserJson<AdminUser>(
      adminPage,
      `/api/admin/users/${user.id}`,
      'PATCH',
      { status: 'disabled' },
    );
    expect(disableResult.status).toBe(200);

    const after = await userPage.request.get('/api/me');
    expect(after.status()).toBe(401);
    const protectedResource = await userPage.request.get('/api/resume');
    expect(protectedResource.status()).toBe(401);
  } finally {
    await adminContext.close();
    await userContext.close();
  }
});

test('resume read, mutation, duplicate, delete, and export stay tenant scoped', async ({ browser }) => {
  const attackerName = uniqueUsername('tenant-a');
  const ownerName = uniqueUsername('tenant-b');
  const adminContext = await newContext(browser);
  const attackerContext = await newContext(browser);
  const ownerContext = await newContext(browser);
  const adminPage = await adminContext.newPage();
  const attackerPage = await attackerContext.newPage();
  const ownerPage = await ownerContext.newPage();

  try {
    await login(adminPage, ADMIN_USERNAME, ADMIN_PASSWORD);
    await setRegistrationMode(adminPage, 'open');
    await register(attackerPage, attackerName);
    await register(ownerPage, ownerName);

    const ownerResume = await browserJson<ResumeRecord>(ownerPage, '/api/resume', 'POST', {
      title: 'Owner confidential resume',
      template: 'classic',
      language: 'en',
    });
    expect(ownerResume.status).toBe(201);
    expect(ownerResume.body?.id).toEqual(expect.any(String));
    const ownerResumeId = ownerResume.body?.id;
    expect(ownerResumeId).toBeTruthy();

    const ownResume = await browserJson<ResumeRecord>(attackerPage, '/api/resume', 'POST', {
      title: 'Attacker own resume',
      template: 'classic',
      language: 'en',
    });
    expect(ownResume.status).toBe(201);

    const foreignOperations = [
      browserJson(attackerPage, `/api/resume/${ownerResumeId}`),
      browserJson(attackerPage, `/api/resume/${ownerResumeId}`, 'PUT', {
        title: 'Cross-tenant overwrite',
      }),
      browserJson(attackerPage, `/api/resume/${ownerResumeId}/duplicate`, 'POST'),
      browserJson(attackerPage, `/api/resume/${ownerResumeId}/export?format=json`),
      browserJson(attackerPage, `/api/resume/${ownerResumeId}`, 'DELETE'),
    ];
    const results = await Promise.all(foreignOperations);
    expect(results.map((result) => result.status)).toEqual([404, 404, 404, 404, 404]);

    const ownerRead = await browserJson<ResumeRecord>(
      ownerPage,
      `/api/resume/${ownerResumeId}`,
    );
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body).toMatchObject({
      id: ownerResumeId,
      title: 'Owner confidential resume',
    });

    const attackerList = await browserJson<ResumeRecord[]>(attackerPage, '/api/resume');
    expect(attackerList.status).toBe(200);
    expect(attackerList.body?.some((resume) => resume.id === ownerResumeId)).toBe(false);
  } finally {
    await adminContext.close();
    await attackerContext.close();
    await ownerContext.close();
  }
});
