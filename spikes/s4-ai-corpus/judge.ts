/**
 * S4 judgments on returned LaTeX: equivalence to an expected formula (normalized string,
 * Compute Engine structure, numeric value), a notation pattern, and numeric values.
 */
import { ComputeEngine } from '@cortex-js/compute-engine';

const ce = new ComputeEngine();

export function norm(s: string): string {
  return s
    .replace(/\\left|\\right/g, '')
    .replace(/\\,|\\;|\\:|\\!|\\quad|\\qquad|~/g, '')
    .replace(/\\mathrm\{d\}/g, 'd')
    .replace(/\\geq\b/g, '\\ge')
    .replace(/\\leq\b/g, '\\le')
    .replace(/\\rightarrow\b/g, '\\to')
    .replace(/\s+/g, '')
    .replace(/\{([A-Za-z0-9])\}/g, '$1');
}

function structural(a: string, b: string): boolean | null {
  try {
    const ea = ce.parse(a);
    const eb = ce.parse(b);
    if (!ea.isValid || !eb.isValid) return null;
    if (ea.isSame(eb)) return true;
    try {
      if (ea.canonical.isSame(eb.canonical)) return true;
    } catch {
      /* ignore */
    }
    try {
      const eq = ea.isEqual(eb);
      if (eq === true) return true;
    } catch {
      /* ignore */
    }
    return false;
  } catch {
    return null;
  }
}

/** Compute Engine's numeric value of the formula, or null when it gives no finite number. */
export function numeric(latex: string): number | null {
  try {
    const e = ce.parse(latex);
    if (!e.isValid) return null;
    const v = e.N() as unknown as { re?: unknown; value?: unknown; valueOf?: () => unknown };
    const cand = [v.re, v.value, typeof v.valueOf === 'function' ? v.valueOf() : undefined];
    for (const c of cand) if (typeof c === 'number' && Number.isFinite(c)) return c;
    return null;
  } catch {
    return null;
  }
}

export function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

export interface Judgment {
  ok: boolean;
  /** string | structural | numeric on success; mismatch | unparsed on failure. */
  judge: string;
}

export function equivalent(expected: string, got: string): Judgment {
  if (norm(expected) === norm(got)) return { ok: true, judge: 'string' };
  const s = structural(expected, got);
  if (s === true) return { ok: true, judge: 'structural' };
  const ne = numeric(expected);
  const ng = numeric(got);
  if (ne !== null && ng !== null && close(ne, ng)) return { ok: true, judge: 'numeric' };
  return { ok: false, judge: s === null ? 'unparsed' : 'mismatch' };
}

/** Equivalent to any of `forms`; the judge gets ':alt' when a form other than the first matched. */
export function equivalentToAny(forms: string[], got: string): Judgment {
  let miss = 'mismatch';
  for (const [i, f] of forms.entries()) {
    const r = equivalent(f, got);
    if (r.ok) return { ok: true, judge: r.judge + (i === 0 ? '' : ':alt') };
    if (r.judge === 'unparsed') miss = 'unparsed';
  }
  return { ok: false, judge: miss };
}

/**
 * For answers too varied to list (multi-line environments) or notation that normalization
 * erases (\mathrm{d}). Matched against the LaTeX with all whitespace removed.
 */
export function matchesPattern(pattern: string, latex: string): boolean {
  return new RegExp(pattern).test(latex.replace(/\s+/g, ''));
}
