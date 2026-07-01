import { z } from 'zod';

const StageResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('waiting-user'),
    summary: z.string(),
    artifacts: z.record(z.string()).optional(),
  }),
  z.object({
    status: z.literal('done'),
    summary: z.string(),
    artifacts: z.record(z.string()).optional(),
  }),
  z.object({
    status: z.literal('blocked'),
    reason: z.string(),
    details: z.string().optional(),
  }),
]);

type StageResult = z.infer<typeof StageResult>;

function parseStageResult(raw: string): StageResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse stage result JSON: ${e}`);
  }
  return StageResult.parse(obj);
}

export { StageResult, parseStageResult };
