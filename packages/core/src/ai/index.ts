// Node-safe entry (no MathLive / DOM): resolver, prompts, result parsing.
export * from './types';
export { normalizeModelLatex, restoreEscapes, stripDelimiters, stripForbidden, parseModelJson } from './normalize';
export {
  buildGenerateMessages,
  buildEditMessages,
  buildScanMessages,
  GENERATE_SYSTEM_PROMPT,
  EDIT_SYSTEM_PROMPT,
  SCAN_SYSTEM_PROMPT,
} from './prompt';
export type { ChatMessage } from './prompt';
export {
  toMathResult,
  toMathEditResult,
  toMathScanResult,
  parseMathResultText,
  parseMathEditResultText,
  parseMathScanResultText,
  ModelOutputError,
} from './result';
export { OpenAICompatibleResolver, createDeepSeekResolver } from './openai-compatible';
export { resolveWithRetry } from './retry';
export { offerKnownReadings } from './semantic';
export type { LatexCheck, RetriedResult } from './retry';
export { locateScanSpans, chunkScanBlocks, mayHoldFormula } from './scan';
export type { ScanBlock, LocatedSpan, ScanRejection, ScanRejectReason } from './scan';
export type { OpenAICompatibleOptions } from './openai-compatible';
