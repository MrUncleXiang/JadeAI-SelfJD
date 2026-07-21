import { z } from 'zod/v4';

const idSchema = z.string().trim().min(1).max(200);
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  jsonPrimitiveSchema,
  z.array(jsonValueSchema).max(200),
  z.record(z.string().max(100), jsonValueSchema),
]));

const objectValueSchema = z.record(z.string().max(100), jsonValueSchema);

const commonOperation = {
  operationId: idSchema,
  reason: z.string().trim().min(1).max(1000),
  evidenceIds: z.array(idSchema).max(50).default([]),
  jdRequirementIds: z.array(idSchema).max(50).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
};

export const resumePatchOperationSchema = z.discriminatedUnion('type', [
  z.object({
    ...commonOperation,
    type: z.literal('set_field'),
    sectionId: idSchema,
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.object({
      field: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
      value: jsonValueSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('add_item'),
    sectionId: idSchema,
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: objectValueSchema,
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('update_item'),
    sectionId: idSchema,
    itemId: idSchema,
    expectedHash: hashSchema,
    value: objectValueSchema,
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('remove_item'),
    sectionId: idSchema,
    itemId: idSchema,
    expectedHash: hashSchema,
    value: z.null().optional(),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('add_section'),
    sectionId: idSchema.nullable().optional(),
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.object({
      id: idSchema,
      type: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
      title: z.string().trim().min(1).max(200),
      sortOrder: z.number().int().min(0).max(100).optional(),
      visible: z.boolean().optional(),
      content: objectValueSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('remove_section'),
    sectionId: idSchema,
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.null().optional(),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('move_section'),
    sectionId: idSchema,
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.object({ sortOrder: z.number().int().min(0).max(100) }).strict(),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('set_visibility'),
    sectionId: idSchema,
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.boolean(),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('set_template'),
    sectionId: z.null().optional(),
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('set_section_title'),
    sectionId: idSchema,
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    ...commonOperation,
    type: z.literal('set_language'),
    sectionId: z.null().optional(),
    itemId: z.null().optional(),
    expectedHash: hashSchema,
    value: z.string().trim().min(2).max(16).regex(/^[a-z]{2}(-[A-Za-z]+)?$/),
  }).strict(),
]);

export const resumePatchSchema = z.object({
  schemaVersion: z.literal(1),
  resumeId: idSchema,
  baseVersionId: idSchema,
  summary: z.string().trim().min(1).max(2000),
  operations: z.array(resumePatchOperationSchema).min(1).max(80),
  warnings: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
}).strict().superRefine((patch, ctx) => {
  const ids = new Set<string>();
  for (let index = 0; index < patch.operations.length; index++) {
    const id = patch.operations[index].operationId;
    if (ids.has(id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['operations', index, 'operationId'],
        message: 'operationId must be unique within a change set',
      });
    }
    ids.add(id);
  }
});

export type ResumePatch = z.infer<typeof resumePatchSchema>;
export type ResumePatchOperation = z.infer<typeof resumePatchOperationSchema>;
export type ResumePatchOperationType = ResumePatchOperation['type'];
