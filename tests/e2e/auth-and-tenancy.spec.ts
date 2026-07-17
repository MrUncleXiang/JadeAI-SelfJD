import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';

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
  sections?: Array<{
    id: string;
    type: string;
    content: Record<string, unknown>;
  }>;
}

interface ResumeVersionRecord {
  id: string;
  versionNumber: number;
  source: string;
}

interface ResumeChangeSetRecord {
  id: string;
  status: string;
  operations: Array<{ operationId: string; result: string }>;
}

interface LlmProfileRecord {
  id: string;
  name: string;
  modelName: string;
  hasApiKey: boolean;
}

interface LlmBindings {
  resume: string | null;
  jd: string | null;
  vision: string | null;
  interview: string | null;
}

function uniqueUsername(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

function contentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
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

test.beforeAll(async ({ request }) => {
  const placeholder = '00000000-0000-4000-8000-000000000000';
  const routes = [
    {
      method: 'GET',
      path: `/api/resumes/${placeholder}/change-sets/${placeholder}`,
    },
    {
      method: 'POST',
      path: `/api/resumes/${placeholder}/change-sets/${placeholder}/apply`,
      data: { operationIds: [] },
    },
    {
      method: 'POST',
      path: `/api/resumes/${placeholder}/versions/${placeholder}/restore`,
    },
    {
      method: 'PUT',
      path: '/api/llm-bindings/resume',
      data: { profileId: null },
    },
  ];

  // Compile the deepest dynamic API routes before a UI assertion depends on
  // them. Next.js dev mode can answer the first lazy-compilation request with
  // its HTML 404; an unauthenticated 401 proves the route is actually ready.
  for (const route of routes) {
    await expect.poll(async () => {
      const response = await request.fetch(route.path, {
        method: route.method,
        ...(route.data ? { data: route.data } : {}),
      });
      return response.status();
    }, { timeout: 60_000 }).toBe(401);
  }
});

test.beforeEach(async ({ context }) => {
  await installStableBrowserState(context);
});

test('career knowledge review workspace is authenticated and queries tenant-scoped facts', async ({ page }) => {
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto('/en/knowledge');

  await expect(page).toHaveURL(/\/en\/knowledge$/);
  await expect(page.getByRole('heading', { name: 'Career Knowledge' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Knowledge' })).toBeVisible();
  await expect(page.getByText('Upload personal information source').first()).toBeVisible();
  await expect(page.getByText('Import public GitHub repository').first()).toBeVisible();
  await expect(page.getByPlaceholder('https://github.com/owner/repository')).toBeVisible();
  await expect(page.getByText('GitHub App advanced connection (optional)').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect GitHub' })).toBeVisible();
  await expect(page.getByText('Short-lived installation tokens stay within one request')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByText('Review status')).toBeVisible();
  await expect(page.getByText('Fact type')).toBeVisible();

  const facts = await browserJson<unknown[]>(page, '/api/career-facts');
  expect(facts.status).toBe(200);
  expect(Array.isArray(facts.body)).toBe(true);
  const publicSources = await browserJson<unknown[]>(page, '/api/sources/github-public');
  expect(publicSources.status).toBe(200);
  expect(Array.isArray(publicSources.body)).toBe(true);
});

test('browser directory upload creates tenant-scoped career facts', async ({ page }) => {
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.goto('/en/knowledge');

  const directoryInput = page.locator('input[type="file"]');
  await expect(directoryInput).toHaveAttribute('webkitdirectory', '');
  const fixtureDirectory = path.resolve('tests/fixtures/workresume-v2');
  await directoryInput.setInputFiles(fixtureDirectory);
  await expect(page.getByText('Selected 7 files. Click Secure import to parse them.')).toBeVisible();

  const createdResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/sources/workresume-upload')
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Secure import' }).click();
  expect((await createdResponse).status()).toBe(201);
  await expect(page.getByText('Personal information source imported')).toBeVisible();
  await expect(page.getByText('Atlas', { exact: true })).toBeVisible();
  await expect(page.getByText('Beacon', { exact: true })).toBeVisible();

  const facts = await browserJson<unknown[]>(page, '/api/career-facts');
  expect(facts.status).toBe(200);
  expect(facts.body).toHaveLength(4);
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
      browserJson(attackerPage, `/api/resumes/${ownerResumeId}/versions`),
      browserJson(attackerPage, `/api/resumes/${ownerResumeId}/change-sets`),
      browserJson(attackerPage, `/api/resumes/${ownerResumeId}/change-sets`, 'POST', {
        candidate: {},
      }),
    ];
    const results = await Promise.all(foreignOperations);
    expect(results.map((result) => result.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);

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

test('reviewable ResumePatch applies a selected subset and restores an old version', async ({ page }) => {
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);

  const created = await browserJson<ResumeRecord>(page, '/api/resume', 'POST', {
    title: 'ResumePatch E2E',
    template: 'classic',
    language: 'en',
    sections: [
      {
        type: 'personal_info',
        title: 'Personal Information',
        visible: true,
        content: {
          fullName: 'Jade Tester',
          jobTitle: 'Original title',
          email: '',
          phone: '',
          location: '',
        },
      },
      {
        type: 'summary',
        title: 'Professional Summary',
        visible: true,
        content: { text: 'Original summary' },
      },
    ],
  });
  expect(created.status).toBe(201);
  const resumeId = created.body?.id;
  expect(resumeId).toBeTruthy();
  const personal = created.body?.sections?.find((section) => section.type === 'personal_info');
  const summary = created.body?.sections?.find((section) => section.type === 'summary');
  expect(personal?.id).toBeTruthy();
  expect(summary?.id).toBeTruthy();

  const baselineResult = await browserJson<ResumeVersionRecord[]>(
    page,
    `/api/resumes/${resumeId}/versions`,
  );
  expect(baselineResult.status).toBe(200);
  expect(baselineResult.body).toHaveLength(1);
  const baseline = baselineResult.body?.[0];
  expect(baseline?.versionNumber).toBe(1);

  const summaryOperationId = `summary-${crypto.randomUUID()}`;
  const titleOperationId = `title-${crypto.randomUUID()}`;
  const proposal = await browserJson<ResumeChangeSetRecord>(
    page,
    `/api/resumes/${resumeId}/change-sets`,
    'POST',
    {
      candidate: {
        schemaVersion: 1,
        resumeId,
        baseVersionId: baseline?.id,
        summary: 'Improve the summary and title',
        warnings: [],
        operations: [
          {
            operationId: summaryOperationId,
            type: 'set_field',
            sectionId: summary?.id,
            expectedHash: contentHash('Original summary'),
            value: { field: 'text', value: 'Improved concise summary' },
            reason: 'Improve clarity without adding new facts',
            evidenceIds: [],
            jdRequirementIds: [],
            confidence: 0.95,
          },
          {
            operationId: titleOperationId,
            type: 'set_field',
            sectionId: personal?.id,
            expectedHash: contentHash('Original title'),
            value: { field: 'jobTitle', value: 'Proposed title' },
            reason: 'Make the title more concise',
            evidenceIds: [],
            jdRequirementIds: [],
            confidence: 0.9,
          },
        ],
      },
    },
  );
  expect(proposal.status).toBe(201);
  expect(proposal.body).toMatchObject({ status: 'validated' });

  await page.goto(`/en/editor/${resumeId}`);
  await expect(page.getByRole('button', { name: 'Chat with AI Assistant' })).toBeVisible();
  await page.getByRole('button', { name: 'Chat with AI Assistant' }).click();
  await page.getByRole('button', { name: 'Review AI changes and resume versions' }).click();
  await expect(page.getByRole('heading', { name: 'Resume Change Review' })).toBeVisible();
  await expect(page.getByText('Improve the summary and title', { exact: true }).first()).toBeVisible();

  const operations = page.getByRole('checkbox');
  await expect(operations).toHaveCount(2);
  await expect(operations.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(operations.nth(1)).toHaveAttribute('aria-checked', 'true');
  await operations.nth(1).click();
  await expect(page.getByText('Selected 1/2')).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => (
      response.url().includes(`/api/resumes/${resumeId}/change-sets/`)
      && response.url().endsWith('/apply')
      && response.request().method() === 'POST'
    )),
    page.getByRole('button', { name: 'Apply Selected' }).click(),
  ]);
  await expect(page.getByText('Selected changes were applied in a new resume version')).toBeVisible();

  const afterApply = await browserJson<ResumeRecord>(page, `/api/resume/${resumeId}`);
  const appliedSummary = afterApply.body?.sections?.find((section) => section.type === 'summary');
  const unchangedPersonal = afterApply.body?.sections?.find((section) => section.type === 'personal_info');
  expect(appliedSummary?.content.text).toBe('Improved concise summary');
  expect(unchangedPersonal?.content.jobTitle).toBe('Original title');

  await page.getByRole('tab', { name: 'Version History' }).click();
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  page.once('dialog', async (dialog) => dialog.accept());
  await Promise.all([
    page.waitForResponse((response) => (
      response.url().endsWith(`/api/resumes/${resumeId}/versions/${baseline?.id}/restore`)
      && response.request().method() === 'POST'
    )),
    page.getByRole('button', { name: 'Restore' }).last().click(),
  ]);
  await expect(page.getByText('Restored the content of version 1')).toBeVisible();

  const afterRestore = await browserJson<ResumeRecord>(page, `/api/resume/${resumeId}`);
  const restoredSummary = afterRestore.body?.sections?.find((section) => section.type === 'summary');
  const restoredPersonal = afterRestore.body?.sections?.find((section) => section.type === 'personal_info');
  expect(restoredSummary?.content.text).toBe('Original summary');
  expect(restoredPersonal?.content.jobTitle).toBe('Original title');

  const storedProposal = await browserJson<ResumeChangeSetRecord>(
    page,
    `/api/resumes/${resumeId}/change-sets/${proposal.body?.id}`,
  );
  expect(storedProposal.status).toBe(200);
  expect(storedProposal.body).toMatchObject({
    status: 'partially_applied',
    operations: [
      { operationId: summaryOperationId, result: 'applied' },
      { operationId: titleOperationId, result: 'not_selected' },
    ],
  });
});

test('legacy browser keys migrate into encrypted per-user LLM profiles and bindings', async ({ page }) => {
  const legacyKey = `e2e-legacy-${crypto.randomUUID()}`;
  await page.addInitScript(({ apiKey }) => {
    localStorage.setItem('jade_api_key', apiKey);
    localStorage.setItem('jade_provider_configs', JSON.stringify({
      openai: {
        baseURL: 'https://8.8.8.8/v1',
        model: 'e2e-model',
        apiKey,
      },
    }));
  }, { apiKey: legacyKey });

  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/legacy browser API key\(s\) detected/i)).toBeVisible();
  await page.getByRole('button', { name: 'Migrate and clear' }).click();

  await expect(page.getByText('Legacy settings migrated and cleared')).toBeVisible();
  await expect(page.getByText('OpenAI / Compatible 1', { exact: true })).toBeVisible();
  await expect(page.getByText(/OpenAI \/ Compatible · e2e-model/)).toBeVisible();

  await expect.poll(() => page.evaluate(() => ({
    key: localStorage.getItem('jade_api_key'),
    providers: localStorage.getItem('jade_provider_configs'),
    imageKey: localStorage.getItem('jade_nanobanana_api_key'),
  }))).toEqual({ key: null, providers: null, imageKey: null });

  const profiles = await browserJson<LlmProfileRecord[]>(page, '/api/llm-profiles');
  expect(profiles.status).toBe(200);
  expect(profiles.body).toHaveLength(1);
  const profile = profiles.body?.[0];
  expect(profile).toMatchObject({
    name: 'OpenAI / Compatible 1',
    modelName: 'e2e-model',
    hasApiKey: true,
  });
  expect(JSON.stringify(profiles.body)).not.toContain(legacyKey);
  expect(JSON.stringify(profiles.body)).not.toContain('encryptedApiKey');

  const bindings = await browserJson<LlmBindings>(page, '/api/llm-bindings');
  expect(bindings.status).toBe(200);
  expect(bindings.body).toEqual({
    resume: profile?.id,
    jd: profile?.id,
    vision: profile?.id,
    interview: profile?.id,
  });
});
