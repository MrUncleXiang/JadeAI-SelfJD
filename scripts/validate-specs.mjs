import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const requiredFiles = [
  'docs/README.md',
  'docs/product/PRD.md',
  'docs/product/requirements-matrix.md',
  'docs/architecture/overview.md',
  'docs/architecture/data-model.md',
  'docs/architecture/auth.md',
  'docs/architecture/github-sync.md',
  'docs/architecture/ai-resume-patch.md',
  'docs/architecture/jd-ingestion.md',
  'docs/security/threat-model.md',
  'docs/api/openapi.yaml',
  'plans/implementation-plan.md',
  'plans/football-platform-decommission.md',
  'acceptance/acceptance-matrix.yaml',
];

const errors = [];
const warnings = [];

function read(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`Missing required file: ${relativePath}`);
    return '';
  }
  return readFileSync(absolutePath, 'utf8');
}

for (const file of requiredFiles) {
  read(file);
}

const requirementsPath = 'docs/product/requirements-matrix.md';
const requirementsText = read(requirementsPath);
const requirementIds = [
  ...requirementsText.matchAll(
    /^\|\s*((?:AUTH|LLM|RES|AI|KB|MYR|GH|JD|INT|OPS|SEC)-\d{3})\s*\|/gm,
  ),
].map((match) => match[1]);

if (requirementIds.length === 0) {
  errors.push('No requirement IDs found in requirements matrix');
}

const requirementSet = new Set(requirementIds);
if (requirementSet.size !== requirementIds.length) {
  const duplicates = requirementIds.filter(
    (id, index) => requirementIds.indexOf(id) !== index,
  );
  errors.push(`Duplicate requirement IDs: ${[...new Set(duplicates)].join(', ')}`);
}

const acceptancePath = 'acceptance/acceptance-matrix.yaml';
const acceptanceText = read(acceptancePath);
const acceptanceRequirements = [
  ...acceptanceText.matchAll(/^\s+requirement:\s+([A-Z]+-\d{3})\s*$/gm),
].map((match) => match[1]);
const acceptanceSet = new Set(acceptanceRequirements);

if (acceptanceSet.size !== acceptanceRequirements.length) {
  const duplicates = acceptanceRequirements.filter(
    (id, index) => acceptanceRequirements.indexOf(id) !== index,
  );
  errors.push(
    `Duplicate acceptance mappings: ${[...new Set(duplicates)].join(', ')}`,
  );
}

const missingAcceptance = requirementIds.filter((id) => !acceptanceSet.has(id));
const unknownAcceptance = acceptanceRequirements.filter(
  (id) => !requirementSet.has(id),
);

if (missingAcceptance.length > 0) {
  errors.push(
    `Requirements without acceptance scenarios: ${missingAcceptance.join(', ')}`,
  );
}
if (unknownAcceptance.length > 0) {
  errors.push(
    `Acceptance scenarios reference unknown requirements: ${unknownAcceptance.join(', ')}`,
  );
}

const scenarioIds = [
  ...acceptanceText.matchAll(/^\s+- id:\s+(ACC-[A-Z]+-\d{3})\s*$/gm),
].map((match) => match[1]);
if (new Set(scenarioIds).size !== scenarioIds.length) {
  errors.push('Acceptance scenario IDs must be unique');
}
if (scenarioIds.length !== acceptanceRequirements.length) {
  errors.push(
    `Acceptance scenario count (${scenarioIds.length}) does not match requirement mapping count (${acceptanceRequirements.length})`,
  );
}

const openApiText = read('docs/api/openapi.yaml');
const openApiRequirementIds = [
  ...openApiText.matchAll(/x-requirement-id:\s+([A-Z]+-\d{3})/g),
].map((match) => match[1]);
const unknownOpenApiRequirements = [
  ...new Set(openApiRequirementIds.filter((id) => !requirementSet.has(id))),
];
if (unknownOpenApiRequirements.length > 0) {
  errors.push(
    `OpenAPI references unknown requirements: ${unknownOpenApiRequirements.join(', ')}`,
  );
}

const excludedCapabilities = [
  'wechat',
  'qq',
  'opentalking',
  'voice-interview',
  'digital-human',
];
for (const capability of excludedCapabilities) {
  if (!acceptanceText.includes(`- ${capability}`)) {
    errors.push(`Missing excluded capability in acceptance matrix: ${capability}`);
  }
}

if (/\bSOC-\d{3}\b/.test(requirementsText + acceptanceText)) {
  errors.push('Social integration requirement IDs are out of scope');
}

const prdText = read('docs/product/PRD.md').toLowerCase();
for (const term of ['微信', 'qq', 'opentalking']) {
  if (!prdText.includes(term.toLowerCase())) {
    errors.push(`PRD must explicitly record excluded scope: ${term}`);
  }
}

const docsIndexPath = resolve(root, 'docs/README.md');
const docsIndex = read('docs/README.md');
for (const match of docsIndex.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^(?:https?:|#)/.test(target)) continue;
  const resolvedTarget = resolve(dirname(docsIndexPath), target);
  if (!existsSync(resolvedTarget)) {
    errors.push(`Broken docs index link: ${target}`);
  }
}

for (const text of [acceptanceText, openApiText]) {
  if (/\t/.test(text)) {
    errors.push('YAML specification files must not contain tab indentation');
  }
}

if (openApiRequirementIds.length === 0) {
  warnings.push('OpenAPI has no requirement traceability entries');
}

if (errors.length > 0) {
  console.error('Specification validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Specification validation passed: ${requirementIds.length} requirements, ${scenarioIds.length} acceptance scenarios, ${openApiRequirementIds.length} OpenAPI requirement references.`,
);
for (const warning of warnings) console.warn(`Warning: ${warning}`);
