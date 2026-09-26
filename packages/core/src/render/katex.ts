/**
 * Tier 1 renderer (design doc D4): synchronous KaTeX with strict error reporting.
 * `trust: false`, `maxExpand` and `maxSize` are part of the safety gate (D14).
 */
import katex from 'katex';

export type RenderResult =
  | { ok: true; html: string; warnings: string[] }
  | { ok: false; message: string; position?: number; length?: number; warnings: string[] };

export interface RenderOptions {
  display: 'inline' | 'block';
  macros?: Record<string, string>;
  maxExpand?: number;
  maxSize?: number;
}

export function renderKatex(latex: string, opts: RenderOptions): RenderResult {
  const warnings: string[] = [];
  try {
    const html = katex.renderToString(latex, {
      displayMode: opts.display === 'block',
      throwOnError: true,
      trust: false,
      maxExpand: opts.maxExpand ?? 1000,
      maxSize: opts.maxSize ?? 100,
      output: 'htmlAndMathml',
      // KaTeX mutates the macros object on \gdef; hand it a copy.
      macros: opts.macros ? { ...opts.macros } : undefined,
      strict: (errorCode: string, errorMsg: string) => {
        warnings.push(`${errorCode}: ${errorMsg}`);
        return 'ignore';
      },
    });
    return { ok: true, html, warnings };
  } catch (e) {
    const err = e as { message?: string; position?: number; length?: number; rawMessage?: string };
    return {
      ok: false,
      message: err.rawMessage ?? err.message ?? String(e),
      position: typeof err.position === 'number' ? err.position : undefined,
      length: typeof err.length === 'number' ? err.length : undefined,
      warnings,
    };
  }
}
