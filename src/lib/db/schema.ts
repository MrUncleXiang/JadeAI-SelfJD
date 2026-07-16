import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text('username'),
  usernameNormalized: text('username_normalized').unique(),
  email: text('email').unique(),
  emailNormalized: text('email_normalized').unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  fingerprint: text('fingerprint').unique(),
  authType: text('auth_type', { enum: ['password', 'oauth', 'fingerprint'] }).notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  status: text('status', { enum: ['active', 'disabled', 'pending'] }).notNull().default('active'),
  tokenVersion: integer('token_version').notNull().default(0),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  settings: text('settings', { mode: 'json' }).default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const authAccounts = sqliteTable('auth_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenType: text('token_type'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const passwordCredentials = sqliteTable('password_credentials', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: integer('password_changed_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  tokenVersion: integer('token_version').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  userAgentHash: text('user_agent_hash'),
  ipPrefix: text('ip_prefix'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
}, (table) => [
  index('auth_sessions_user_id_idx').on(table.userId),
  index('auth_sessions_expires_at_idx').on(table.expiresAt),
]);

export const authRateLimits = sqliteTable('auth_rate_limits', {
  keyHash: text('key_hash').primaryKey(),
  scope: text('scope').notNull(),
  windowStartedAt: integer('window_started_at', { mode: 'timestamp' }).notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  blockedUntil: integer('blocked_until', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('auth_rate_limits_blocked_until_idx').on(table.blockedUntil),
]);

export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  codeHash: text('code_hash').notNull().unique(),
  maxUses: integer('max_uses').notNull().default(1),
  useCount: integer('use_count').notNull().default(0),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  disabledAt: integer('disabled_at', { mode: 'timestamp' }),
}, (table) => [index('invitations_created_by_idx').on(table.createdBy)]);

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorUserId: text('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
  requestId: text('request_id'),
  metadata: text('metadata', { mode: 'json' }).notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('audit_events_actor_idx').on(table.actorUserId),
  index('audit_events_created_at_idx').on(table.createdAt),
]);

export const llmProfiles = sqliteTable('llm_profiles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider', {
    enum: ['openai-compatible', 'anthropic', 'gemini'],
  }).notNull(),
  baseUrl: text('base_url').notNull(),
  modelName: text('model_name').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  keyIv: text('key_iv').notNull(),
  keyTag: text('key_tag').notNull(),
  keyVersion: integer('key_version').notNull(),
  capabilities: text('capabilities', { mode: 'json' }).notNull().default('{}'),
  status: text('status', {
    enum: ['active', 'invalid', 'disabled', 'untested'],
  }).notNull().default('untested'),
  lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('llm_profiles_user_id_idx').on(table.userId),
]);

export const llmFeatureBindings = sqliteTable('llm_feature_bindings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  feature: text('feature', {
    enum: ['resume', 'jd', 'vision', 'interview'],
  }).notNull(),
  llmProfileId: text('llm_profile_id').notNull().references(() => llmProfiles.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('llm_feature_bindings_user_feature_uq').on(table.userId, table.feature),
  index('llm_feature_bindings_profile_id_idx').on(table.llmProfileId),
]);

export const resumes = sqliteTable('resumes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull().default('未命名简历'),
  template: text('template').notNull().default('classic'),
  themeConfig: text('theme_config', { mode: 'json' }).default('{}'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  language: text('language').notNull().default('zh'),
  shareToken: text('share_token'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  sharePassword: text('share_password'),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const resumeVersions = sqliteTable('resume_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  snapshot: text('snapshot', { mode: 'json' }).notNull(),
  source: text('source', {
    enum: ['manual', 'ai-change-set', 'restore', 'import'],
  }).notNull(),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('resume_versions_resume_number_uq').on(table.resumeId, table.versionNumber),
  index('resume_versions_user_resume_idx').on(table.userId, table.resumeId),
  index('resume_versions_resume_created_at_idx').on(table.resumeId, table.createdAt),
]);

export const resumeChangeSets = sqliteTable('resume_change_sets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  baseVersionId: text('base_version_id').notNull().references(() => resumeVersions.id, { onDelete: 'cascade' }),
  appliedVersionId: text('applied_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['proposed', 'validated', 'stale', 'partially_applied', 'applied', 'rejected', 'failed'],
  }).notNull().default('validated'),
  llmProfileId: text('llm_profile_id').references(() => llmProfiles.id, { onDelete: 'set null' }),
  provider: text('provider'),
  modelName: text('model_name'),
  promptVersion: text('prompt_version').notNull().default('resume-patch-v1'),
  requestId: text('request_id'),
  summary: text('summary').notNull().default(''),
  warnings: text('warnings', { mode: 'json' }).notNull().default('[]'),
  validationResult: text('validation_result', { mode: 'json' }).notNull().default('{}'),
  rawModelOutput: text('raw_model_output'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('resume_change_sets_user_resume_idx').on(table.userId, table.resumeId),
  index('resume_change_sets_base_version_idx').on(table.baseVersionId),
  index('resume_change_sets_created_at_idx').on(table.createdAt),
]);

export const resumeChangeOperations = sqliteTable('resume_change_operations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  changeSetId: text('change_set_id').notNull().references(() => resumeChangeSets.id, { onDelete: 'cascade' }),
  operationId: text('operation_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  type: text('type', {
    enum: [
      'set_field',
      'add_item',
      'update_item',
      'remove_item',
      'add_section',
      'remove_section',
      'move_section',
      'set_visibility',
      'set_template',
    ],
  }).notNull(),
  sectionId: text('section_id'),
  itemId: text('item_id'),
  expectedHash: text('expected_hash'),
  value: text('value', { mode: 'json' }),
  reason: text('reason').notNull(),
  evidenceIds: text('evidence_ids', { mode: 'json' }).notNull().default('[]'),
  jdRequirementIds: text('jd_requirement_ids', { mode: 'json' }).notNull().default('[]'),
  confidenceBasisPoints: integer('confidence_basis_points').notNull().default(0),
  diff: text('diff', { mode: 'json' }).notNull().default('{}'),
  selected: integer('selected', { mode: 'boolean' }).notNull().default(false),
  result: text('result', {
    enum: ['pending', 'applied', 'not_selected', 'failed'],
  }).notNull().default('pending'),
  errorCode: text('error_code'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('resume_change_operations_set_operation_uq').on(table.changeSetId, table.operationId),
  index('resume_change_operations_change_set_idx').on(table.changeSetId, table.sortOrder),
]);

export const resumeSections = sqliteTable('resume_sections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
  content: text('content', { mode: 'json' }).notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('新对话'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const resumeShares = sqliteTable('resume_shares', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  label: text('label').notNull().default(''),
  password: text('password'),
  viewCount: integer('view_count').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const jdAnalyses = sqliteTable('jd_analyses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  jobDescription: text('job_description').notNull(),
  result: text('result', { mode: 'json' }).notNull(),
  overallScore: integer('overall_score').notNull(),
  atsScore: integer('ats_score').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const grammarChecks = sqliteTable('grammar_checks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  result: text('result', { mode: 'json' }).notNull(),
  score: integer('score').notNull(),
  issueCount: integer('issue_count').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export {
  interviewSessions,
  interviewRounds,
  interviewMessages,
  interviewReports,
} from './schema-interview';
