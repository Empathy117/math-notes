/**
 * Coerce whatever a model returned into the MathResult / MathEditResult contract.
 * Missing or malformed fields degrade gracefully; the renderer stays the final judge.
 */
import { normalizeModelLatex, parseModelJson } from './normalize';
import type { Confidence, MathAlternative, MathEditResult, MathResult, MathScanResult, MathScanSpan, MathStatus } from './types';

const STATUSES: MathStatus[] = ['ok', 'ambiguous', 'unsupported', 'not_math'];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Alternatives or notations: non-empty, and not the primary formula again. */
function formulaList(v: unknown, primary: string): MathAlternative[] {
  return Array.isArray(v)
    ? v
        .map((a) => {
          const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
          return { latex: normalizeModelLatex(str(x['latex'])), interpretation: str(x['interpretation']) };
        })
        .filter((a) => a.latex !== '' && a.latex !== primary)
    : [];
}

export function toMathResult(payload: unknown, raw?: unknown): MathResult {
  const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const latex = normalizeModelLatex(str(o['latex']));
  let status = STATUSES.includes(o['status'] as MathStatus) ? (o['status'] as MathStatus) : 'ok';
  if ((status === 'ok' || status === 'ambiguous') && latex === '') status = 'not_math';
  const alternatives = formulaList(o['alternatives'], latex);
  // Alternatives are other readings (D6), so an answer that has any is ambiguous whatever status
  // the model gave, and an ambiguous answer without any leaves the chip nothing to offer. Hiding a
  // different reading costs more than showing one chip too many (S4).
  if (status === 'ok' && alternatives.length > 0) status = 'ambiguous';
  else if (status === 'ambiguous' && alternatives.length === 0) status = 'ok';
  const c = (o['consistency'] && typeof o['consistency'] === 'object' ? o['consistency'] : {}) as Record<string, unknown>;
  const expected = c['expected'];
  return {
    status,
    interpretation: str(o['interpretation']),
    latex,
    alternatives,
    notations: formulaList(o['notations'], latex),
    features: strList(o['features']),
    confidence: CONFIDENCES.includes(o['confidence'] as Confidence) ? (o['confidence'] as Confidence) : 'medium',
    consistency:
      c['kind'] === 'numeric' && (typeof expected === 'string' || typeof expected === 'number')
        ? { kind: 'numeric', expected: String(expected) }
        : { kind: 'none' },
    notes: str(o['notes']) || undefined,
    raw,
  };
}

export function toMathEditResult(payload: unknown, originalSelection: string, raw?: unknown): MathEditResult {
  const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const s = o['status'];
  const status: MathEditResult['status'] = s === 'unsupported' || s === 'unclear' ? s : 'ok';
  const replacement = normalizeModelLatex(str(o['replacementLatex']));
  return {
    status,
    replacementLatex: status === 'ok' && replacement !== '' ? replacement : originalSelection,
    interpretation: str(o['interpretation']) || undefined,
    confidence: CONFIDENCES.includes(o['confidence'] as Confidence) ? (o['confidence'] as Confidence) : 'medium',
    raw,
  };
}

/**
 * The model answered, but not with a usable payload: cut off by max_tokens, or JSON too broken
 * to mend. Asking once more usually helps (see resolveWithRetry).
 */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

/**
 * Text that set out to be a JSON object. The one-line-LaTeX fallback would insert the JSON
 * itself as a formula, and KaTeX renders it whenever the braces happen to balance.
 */
function looksLikeJson(text: string): boolean {
  return /^\s*(```(?:json)?\s*)?\{\s*"/i.test(text);
}

export function parseMathResultText(text: string): MathResult {
  const json = parseModelJson(text);
  if (json) return toMathResult(json, text);
  if (looksLikeJson(text)) throw new ModelOutputError('model returned malformed JSON');
  // Not JSON at all: treat the whole text as a bare formula (the "one line of LaTeX" fallback).
  const latex = normalizeModelLatex(text.split('\n')[0] ?? '');
  return toMathResult({ status: latex ? 'ok' : 'not_math', latex, confidence: 'low', interpretation: '' }, text);
}

export function parseMathEditResultText(text: string, originalSelection: string): MathEditResult {
  const json = parseModelJson(text);
  if (json) return toMathEditResult(json, originalSelection, text);
  if (looksLikeJson(text)) throw new ModelOutputError('model returned malformed JSON');
  const replacement = normalizeModelLatex(text.split('\n')[0] ?? '');
  return toMathEditResult({ status: 'ok', replacementLatex: replacement, confidence: 'low' }, originalSelection, text);
}

/** Spans with a block, a quote and a formula; anything else in the list is dropped. */
export function toMathScanResult(payload: unknown, raw?: unknown): MathScanResult {
  const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const list = Array.isArray(o['spans']) ? o['spans'] : [];
  const spans: MathScanSpan[] = [];
  for (const item of list) {
    const x = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const block = x['block'] ?? x['id'];
    const span = {
      block: typeof block === 'string' ? block : typeof block === 'number' ? String(block) : '',
      quote: str(x['quote']),
      latex: normalizeModelLatex(str(x['latex'])),
      interpretation: str(x['interpretation']),
    };
    if (span.block && span.quote.trim() && span.latex) spans.push(span);
  }
  return { spans, raw };
}

export function parseMathScanResultText(text: string): MathScanResult {
  const json = parseModelJson(text);
  if (json) return toMathScanResult(json, text);
  throw new ModelOutputError(looksLikeJson(text) ? 'model returned malformed JSON' : 'model returned no JSON');
}
