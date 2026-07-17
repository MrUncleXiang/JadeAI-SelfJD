/**
 * PostgreSQL schema — mirrors schema.ts (SQLite) with PG-native types.
 * Used ONLY by drizzle-kit for PG migration generation.
 * Runtime code still imports table objects from schema.ts.
 */
import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { CareerSourceType } from '@/lib/career/types';

const epochNow = sql`extract(epoch from now())::integer`;

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text('username'),
  usernameNormalized: text('username_normalized').unique(),
  email: text('email').unique(),
  emailNormalized: text('email_normalized').unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  fingerprint: text('fingerprint').unique(),
  authType: text('auth_type').notNull(),
  role: text('role').notNull().default('user'),
  status: text('status').notNull().default('active'),
  tokenVersion: integer('token_version').notNull().default(0),
  lastLoginAt: integer('last_login_at'),
  settings: text('settings').default('{}'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
  deletedAt: integer('deleted_at'),
});

export const authAccounts = pgTable('auth_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenType: text('token_type'),
  expiresAt: integer('expires_at'),
  scope: text('scope'),
  createdAt: integer('created_at').notNull().default(epochNow),
});

export const passwordCredentials = pgTable('password_credentials', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: integer('password_changed_at').notNull().default(epochNow),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  tokenVersion: integer('token_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull().default(epochNow),
  userAgentHash: text('user_agent_hash'),
  ipPrefix: text('ip_prefix'),
  createdAt: integer('created_at').notNull().default(epochNow),
  revokedAt: integer('revoked_at'),
}, (table) => [
  index('auth_sessions_user_id_idx').on(table.userId),
  index('auth_sessions_expires_at_idx').on(table.expiresAt),
]);

export const authRateLimits = pgTable('auth_rate_limits', {
  keyHash: text('key_hash').primaryKey(),
  scope: text('scope').notNull(),
  windowStartedAt: integer('window_started_at').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  blockedUntil: integer('blocked_until'),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  index('auth_rate_limits_blocked_until_idx').on(table.blockedUntil),
]);

export const invitations = pgTable('invitations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  codeHash: text('code_hash').notNull().unique(),
  maxUses: integer('max_uses').notNull().default(1),
  useCount: integer('use_count').notNull().default(0),
  expiresAt: integer('expires_at'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at').notNull().default(epochNow),
  disabledAt: integer('disabled_at'),
}, (table) => [index('invitations_created_by_idx').on(table.createdBy)]);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorUserId: text('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  outcome: text('outcome').notNull(),
  requestId: text('request_id'),
  metadata: text('metadata').notNull().default('{}'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  index('audit_events_actor_idx').on(table.actorUserId),
  index('audit_events_created_at_idx').on(table.createdAt),
]);

export const llmProfiles = pgTable('llm_profiles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  baseUrl: text('base_url').notNull(),
  modelName: text('model_name').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  keyIv: text('key_iv').notNull(),
  keyTag: text('key_tag').notNull(),
  keyVersion: integer('key_version').notNull(),
  capabilities: text('capabilities').notNull().default('{}'),
  status: text('status').notNull().default('untested'),
  lastTestedAt: integer('last_tested_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  index('llm_profiles_user_id_idx').on(table.userId),
]);

export const llmFeatureBindings = pgTable('llm_feature_bindings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  feature: text('feature').notNull(),
  llmProfileId: text('llm_profile_id').notNull().references(() => llmProfiles.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('llm_feature_bindings_user_feature_uq').on(table.userId, table.feature),
  index('llm_feature_bindings_profile_id_idx').on(table.llmProfileId),
]);

export const sourceConnections = pgTable('source_connections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('pending'),
  lastSyncedAt: integer('last_synced_at'),
  lastErrorCode: text('last_error_code'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  index('source_connections_user_provider_idx').on(table.userId, table.provider),
]);

export const githubPatCredentials = pgTable('github_pat_credentials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceConnectionId: text('source_connection_id').notNull().unique()
    .references(() => sourceConnections.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  accountId: text('account_id').notNull(),
  accountLogin: text('account_login').notNull(),
  encryptedToken: text('encrypted_token').notNull(),
  tokenIv: text('token_iv').notNull(),
  tokenTag: text('token_tag').notNull(),
  keyVersion: integer('key_version').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  index('github_pat_credentials_user_idx').on(table.userId),
  index('github_pat_credentials_account_idx').on(table.accountId),
]);

export const githubConnectionStates = pgTable('github_connection_states', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceConnectionId: text('source_connection_id').notNull()
    .references(() => sourceConnections.id, { onDelete: 'cascade' }),
  stateHash: text('state_hash').notNull().unique(),
  returnPath: text('return_path').notNull().default('/knowledge'),
  expiresAt: integer('expires_at').notNull(),
  consumedAt: integer('consumed_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  index('github_connection_states_user_idx').on(table.userId),
  index('github_connection_states_expires_at_idx').on(table.expiresAt),
]);

export const githubInstallations = pgTable('github_installations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceConnectionId: text('source_connection_id').notNull().unique()
    .references(() => sourceConnections.id, { onDelete: 'cascade' }),
  installationId: text('installation_id').notNull().unique(),
  accountId: text('account_id').notNull(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  repositorySelection: text('repository_selection').notNull(),
  permissions: text('permissions').notNull().default('{}'),
  suspendedAt: integer('suspended_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  index('github_installations_user_idx').on(table.userId),
  index('github_installations_account_idx').on(table.accountId),
]);

export const sourceRepositories = pgTable('source_repositories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').$type<CareerSourceType>().notNull(),
  sourceConnectionId: text('source_connection_id'),
  externalRepositoryId: text('external_repository_id').notNull(),
  fullName: text('full_name').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  selected: integer('selected').notNull().default(1),
  lastHeadSha: text('last_head_sha'),
  lastSyncedAt: integer('last_synced_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('source_repositories_user_source_external_uq')
    .on(table.userId, table.sourceType, table.externalRepositoryId),
  index('source_repositories_user_id_idx').on(table.userId),
  index('source_repositories_connection_selected_idx').on(table.sourceConnectionId, table.selected),
]);

export const sourceSnapshots = pgTable('source_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceRepositoryId: text('source_repository_id').notNull()
    .references(() => sourceRepositories.id, { onDelete: 'cascade' }),
  commitSha: text('commit_sha').notNull(),
  treeSha: text('tree_sha'),
  parentSnapshotId: text('parent_snapshot_id'),
  status: text('status').notNull().default('pending'),
  parserId: text('parser_id').notNull(),
  parserVersion: text('parser_version').notNull(),
  errorCode: text('error_code'),
  createdAt: integer('created_at').notNull().default(epochNow),
  completedAt: integer('completed_at'),
}, (table) => [
  uniqueIndex('source_snapshots_repository_commit_uq')
    .on(table.sourceRepositoryId, table.commitSha, table.parserId, table.parserVersion),
  index('source_snapshots_user_id_idx').on(table.userId),
]);

export const sourceDocuments = pgTable('source_documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceSnapshotId: text('source_snapshot_id').notNull()
    .references(() => sourceSnapshots.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  blobSha: text('blob_sha'),
  contentHash: text('content_hash').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  textContent: text('text_content'),
  parseStatus: text('parse_status').notNull().default('ready'),
  securityFindings: text('security_findings').notNull().default('[]'),
  llmEligible: integer('llm_eligible').notNull().default(1),
  parserId: text('parser_id').notNull(),
  parserVersion: text('parser_version').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('source_documents_snapshot_path_uq').on(table.sourceSnapshotId, table.path),
  index('source_documents_user_id_idx').on(table.userId),
]);

export const syncJobs = pgTable('sync_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceConnectionId: text('source_connection_id').notNull()
    .references(() => sourceConnections.id, { onDelete: 'cascade' }),
  sourceRepositoryId: text('source_repository_id')
    .references(() => sourceRepositories.id, { onDelete: 'set null' }),
  trigger: text('trigger').notNull(),
  status: text('status').notNull().default('queued'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  requestedCommitSha: text('requested_commit_sha'),
  attemptCount: integer('attempt_count').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  requestId: text('request_id'),
  webhookDeliveryId: text('webhook_delivery_id'),
  nextAttemptAt: integer('next_attempt_at'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  index('sync_jobs_user_status_idx').on(table.userId, table.status),
  index('sync_jobs_repository_created_idx').on(table.sourceRepositoryId, table.createdAt),
  index('sync_jobs_next_attempt_idx').on(table.status, table.nextAttemptAt),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  eventType: text('event_type').notNull(),
  installationId: text('installation_id'),
  repositoryExternalId: text('repository_external_id'),
  ref: text('ref'),
  beforeSha: text('before_sha'),
  afterSha: text('after_sha'),
  payloadHash: text('payload_hash').notNull(),
  status: text('status').notNull().default('accepted'),
  syncJobId: text('sync_job_id').references(() => syncJobs.id, { onDelete: 'set null' }),
  errorCode: text('error_code'),
  receivedAt: integer('received_at').notNull().default(epochNow),
  processedAt: integer('processed_at'),
}, (table) => [
  index('webhook_deliveries_installation_idx').on(table.installationId, table.receivedAt),
  index('webhook_deliveries_repository_idx').on(table.repositoryExternalId, table.receivedAt),
]);

export const careerFacts = pgTable('career_facts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  factType: text('fact_type').notNull(),
  canonicalKey: text('canonical_key').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  structuredData: text('structured_data').notNull().default('{}'),
  status: text('status').notNull().default('draft'),
  confidenceBasisPoints: integer('confidence_basis_points').notNull().default(0),
  contentHash: text('content_hash').notNull(),
  supersedesFactId: text('supersedes_fact_id'),
  supersededByFactId: text('superseded_by_fact_id'),
  createdBy: text('created_by').notNull().default('import'),
  approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: integer('approved_at'),
  sourceParserId: text('source_parser_id'),
  sourceParserVersion: text('source_parser_version'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('career_facts_user_key_hash_uq').on(table.userId, table.canonicalKey, table.contentHash),
  index('career_facts_user_status_type_idx').on(table.userId, table.status, table.factType),
  index('career_facts_supersedes_idx').on(table.supersedesFactId),
]);

export const careerFactEvidence = pgTable('career_fact_evidence', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  careerFactId: text('career_fact_id').notNull().references(() => careerFacts.id, { onDelete: 'cascade' }),
  sourceDocumentId: text('source_document_id').notNull()
    .references(() => sourceDocuments.id, { onDelete: 'cascade' }),
  commitSha: text('commit_sha').notNull(),
  path: text('path').notNull(),
  locator: text('locator').notNull(),
  contentHash: text('content_hash').notNull(),
  excerptHash: text('excerpt_hash'),
  summary: text('summary').notNull().default(''),
  parserId: text('parser_id').notNull(),
  parserVersion: text('parser_version').notNull(),
  stale: integer('stale').notNull().default(0),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('career_fact_evidence_fact_document_locator_hash_uq')
    .on(table.careerFactId, table.sourceDocumentId, table.locator, table.contentHash),
  index('career_fact_evidence_user_fact_idx').on(table.userId, table.careerFactId),
]);

export const careerFactClaims = pgTable('career_fact_claims', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  careerFactId: text('career_fact_id').notNull().references(() => careerFacts.id, { onDelete: 'cascade' }),
  claimType: text('claim_type').notNull(),
  claim: text('claim').notNull(),
  normalizedClaim: text('normalized_claim').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('career_fact_claims_fact_type_normalized_uq')
    .on(table.careerFactId, table.claimType, table.normalizedClaim),
  index('career_fact_claims_user_fact_idx').on(table.userId, table.careerFactId),
]);

export const careerFactRelations = pgTable('career_fact_relations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  careerFactId: text('career_fact_id').notNull().references(() => careerFacts.id, { onDelete: 'cascade' }),
  relatedFactId: text('related_fact_id').notNull().references(() => careerFacts.id, { onDelete: 'cascade' }),
  relationType: text('relation_type').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('career_fact_relations_fact_related_type_uq')
    .on(table.careerFactId, table.relatedFactId, table.relationType),
  index('career_fact_relations_user_fact_idx').on(table.userId, table.careerFactId),
]);

export const factReviewEvents = pgTable('fact_review_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  careerFactId: text('career_fact_id').notNull().references(() => careerFacts.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  beforeState: text('before_state'),
  afterState: text('after_state'),
  note: text('note'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  index('fact_review_events_user_fact_created_idx').on(table.userId, table.careerFactId, table.createdAt),
]);

export const jdSources = pgTable('jd_sources', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  inputType: text('input_type').notNull(),
  title: text('title').notNull().default(''),
  company: text('company').notNull().default(''),
  jobTitle: text('job_title').notNull().default(''),
  location: text('location').notNull().default(''),
  originalFilename: text('original_filename'),
  mimeType: text('mime_type').notNull().default('text/plain'),
  sizeBytes: integer('size_bytes').notNull(),
  contentHash: text('content_hash').notNull(),
  rawText: text('raw_text').notNull(),
  normalizedText: text('normalized_text').notNull(),
  status: text('status').notNull().default('draft'),
  parserId: text('parser_id'),
  parserVersion: text('parser_version'),
  errorCode: text('error_code'),
  confirmedAt: integer('confirmed_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('jd_sources_user_content_hash_uq').on(table.userId, table.contentHash),
  index('jd_sources_user_status_updated_idx').on(table.userId, table.status, table.updatedAt),
]);

export const jdRequirements = pgTable('jd_requirements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jdSourceId: text('jd_source_id').notNull().references(() => jdSources.id, { onDelete: 'cascade' }),
  requirementType: text('requirement_type').notNull(),
  text: text('text').notNull(),
  normalizedTerm: text('normalized_term').notNull().default(''),
  aliases: text('aliases').notNull().default('[]'),
  priority: text('priority').notNull().default('normal'),
  importanceBasisPoints: integer('importance_basis_points').notNull().default(5_000),
  sourceLocator: text('source_locator').notNull().default('{}'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('jd_requirements_source_sort_uq').on(table.jdSourceId, table.sortOrder),
  index('jd_requirements_user_source_idx').on(table.userId, table.jdSourceId),
]);

export const resumes = pgTable('resumes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default('未命名简历'),
  template: text('template').notNull().default('classic'),
  themeConfig: text('theme_config').default('{}'),
  isDefault: integer('is_default').notNull().default(0),
  language: text('language').notNull().default('zh'),
  shareToken: text('share_token'),
  isPublic: integer('is_public').notNull().default(0),
  sharePassword: text('share_password'),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const resumeVersions = pgTable('resume_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  snapshot: text('snapshot').notNull(),
  source: text('source').notNull(),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('resume_versions_resume_number_uq').on(table.resumeId, table.versionNumber),
  index('resume_versions_user_resume_idx').on(table.userId, table.resumeId),
  index('resume_versions_resume_created_at_idx').on(table.resumeId, table.createdAt),
]);

export const resumeChangeSets = pgTable('resume_change_sets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  baseVersionId: text('base_version_id').notNull().references(() => resumeVersions.id, { onDelete: 'cascade' }),
  appliedVersionId: text('applied_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('validated'),
  llmProfileId: text('llm_profile_id').references(() => llmProfiles.id, { onDelete: 'set null' }),
  provider: text('provider'),
  modelName: text('model_name'),
  promptVersion: text('prompt_version').notNull().default('resume-patch-v1'),
  requestId: text('request_id'),
  summary: text('summary').notNull().default(''),
  warnings: text('warnings').notNull().default('[]'),
  validationResult: text('validation_result').notNull().default('{}'),
  rawModelOutput: text('raw_model_output'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => [
  index('resume_change_sets_user_resume_idx').on(table.userId, table.resumeId),
  index('resume_change_sets_base_version_idx').on(table.baseVersionId),
  index('resume_change_sets_created_at_idx').on(table.createdAt),
]);

export const resumeChangeOperations = pgTable('resume_change_operations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  changeSetId: text('change_set_id').notNull().references(() => resumeChangeSets.id, { onDelete: 'cascade' }),
  operationId: text('operation_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  type: text('type').notNull(),
  sectionId: text('section_id'),
  itemId: text('item_id'),
  expectedHash: text('expected_hash'),
  value: text('value'),
  reason: text('reason').notNull(),
  evidenceIds: text('evidence_ids').notNull().default('[]'),
  jdRequirementIds: text('jd_requirement_ids').notNull().default('[]'),
  confidenceBasisPoints: integer('confidence_basis_points').notNull().default(0),
  diff: text('diff').notNull().default('{}'),
  selected: integer('selected').notNull().default(0),
  result: text('result').notNull().default('pending'),
  errorCode: text('error_code'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => [
  uniqueIndex('resume_change_operations_set_operation_uq').on(table.changeSetId, table.operationId),
  index('resume_change_operations_change_set_idx').on(table.changeSetId, table.sortOrder),
]);

export const resumeSections = pgTable('resume_sections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  visible: integer('visible').notNull().default(1),
  content: text('content').notNull().default('{}'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull(),
  title: text('title').notNull().default('新对话'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata').default('{}'),
  createdAt: integer('created_at').notNull().default(epochNow),
});

export const resumeShares = pgTable('resume_shares', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull(),
  token: text('token').notNull().unique(),
  label: text('label').notNull().default(''),
  password: text('password'),
  viewCount: integer('view_count').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const jdAnalyses = pgTable('jd_analyses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull(),
  jobDescription: text('job_description').notNull(),
  result: text('result').notNull(),
  overallScore: integer('overall_score').notNull(),
  atsScore: integer('ats_score').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
});

export const grammarChecks = pgTable('grammar_checks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull(),
  result: text('result').notNull(),
  score: integer('score').notNull(),
  issueCount: integer('issue_count').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
});

// ── Interview simulation tables ──

export const interviewSessions = pgTable('interview_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull(),
  resumeId: text('resume_id'),
  jobDescription: text('job_description').notNull(),
  jobTitle: text('job_title').notNull().default(''),
  selectedInterviewers: text('selected_interviewers').notNull().default('[]'),
  currentRound: integer('current_round').notNull().default(0),
  status: text('status').notNull().default('preparing'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const interviewRounds = pgTable('interview_rounds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull(),
  interviewerType: text('interviewer_type').notNull(),
  interviewerConfig: text('interviewer_config').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  status: text('status').notNull().default('pending'),
  questionCount: integer('question_count').notNull().default(0),
  maxQuestions: integer('max_questions').notNull().default(10),
  summary: text('summary'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const interviewMessages = pgTable('interview_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roundId: text('round_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata').default('{}'),
  createdAt: integer('created_at').notNull().default(epochNow),
});

export const interviewReports = pgTable('interview_reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().unique(),
  overallScore: integer('overall_score').notNull(),
  dimensionScores: text('dimension_scores').notNull(),
  roundEvaluations: text('round_evaluations').notNull(),
  overallFeedback: text('overall_feedback').notNull(),
  improvementPlan: text('improvement_plan').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
});
