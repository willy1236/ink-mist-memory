import { loadMemoryCached } from '../memory/index.js';
import { loadSignals, runPipeline } from '../match/pipeline.js';
import type { HandlerContext, HandlerResult } from '../shell/types.js';

/** UserPromptSubmit：解析記憶庫、載入各訊號後交給管線產出排好序的候選條目或精簡索引。 */
export default async function userPromptSubmit(ctx: HandlerContext): Promise<HandlerResult> {
  const { signals, notes } = await loadSignals();
  const memory = loadMemoryCached(ctx.memoryRoot);
  const result = runPipeline(ctx, memory, signals);
  return { ...result, notes: [...notes, ...result.notes] };
}
