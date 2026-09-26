export * from './intent/classify';
export * from './ai/types';
export { normalizeModelLatex, restoreEscapes, stripDelimiters, stripForbidden, parseModelJson } from './ai/normalize';
export {
  buildGenerateMessages,
  buildEditMessages,
  buildScanMessages,
  GENERATE_SYSTEM_PROMPT,
  EDIT_SYSTEM_PROMPT,
  SCAN_SYSTEM_PROMPT,
} from './ai/prompt';
export type { ChatMessage } from './ai/prompt';
export {
  toMathResult,
  toMathEditResult,
  toMathScanResult,
  parseMathResultText,
  parseMathEditResultText,
  parseMathScanResultText,
  ModelOutputError,
} from './ai/result';
export { OpenAICompatibleResolver, createDeepSeekResolver } from './ai/openai-compatible';
export type { OpenAICompatibleOptions } from './ai/openai-compatible';
export { resolveWithRetry } from './ai/retry';
export { offerKnownReadings } from './ai/semantic';
export type { LatexCheck, RetriedResult } from './ai/retry';
export { locateScanSpans, chunkScanBlocks, mayHoldFormula } from './ai/scan';
export type { ScanBlock, LocatedSpan, ScanRejection, ScanRejectReason } from './ai/scan';
export * from './adapter/types';
export { configureMathLive, mathLiveFactory, MathLiveEditor } from './adapter/mathlive-adapter';
export { toEditorLatex, fromEditorLatex } from './adapter/latex-shims';
export { SourceMathEditor, sourceEditorFactory } from './source/source-editor';
export * from './render/katex';
export { mathExtensions, MathInline, MathBlock, MATH_NODE_NAMES, newMathId } from './tiptap/math-node';
export type { MathExtensionOptions, MathConversion } from './tiptap/math-node';
export { projectTextblocks, textRange, findFormulaDescriptions } from './tiptap/scan';
export { MarkdownReveal, markdownMarkers } from './tiptap/markdown-reveal';
export type { MarkdownMarker } from './tiptap/markdown-reveal';
export type { ProjectedBlock, FoundDescription, ScanOutcome, ScanOptions } from './tiptap/scan';
export { MathNodeView } from './tiptap/math-node-view';
export type { InlineEditMode, EditMode, MathEditorKind, LayoutMetrics, MathNodeViewConfig, OpenOptions } from './tiptap/math-node-view';
