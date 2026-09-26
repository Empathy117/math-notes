/**
 * The sync gate's single retry (design doc D6): when the renderer rejects the LaTeX the model
 * returned, send the error back once; when the answer itself was unusable (cut off, broken
 * JSON), ask again once. The second answer is returned as is; the caller checks it again and
 * shows a boundary hint if it still fails. Either way the alternatives the chip will offer are
 * curated here: the unrenderable ones dropped, the readings the host knows of added.
 *
 * The renderer check is injected so this module stays free of KaTeX and the DOM. Telling a
 * syntax slip from an unsupported construct needs the capability registry (S3); until then
 * every rejection gets the one retry.
 */
import { ModelOutputError } from './result';
import { offerKnownReadings } from './semantic';
import type { MathGenerateRequest, MathResolver, MathResult } from './types';

/** `renderKatex(latex, { display })` fits this shape. */
export type LatexCheck = (latex: string) => { ok: true } | { ok: false; message: string; position?: number };

export interface RetriedResult {
  result: MathResult;
  /**
   * What used up the one retry: the rejected LaTeX and the renderer error, or an empty `latex`
   * and the ModelOutputError message.
   */
  retried?: { latex: string; message: string };
}

export async function resolveWithRetry(
  resolver: MathResolver,
  req: MathGenerateRequest,
  check: LatexCheck,
  opts?: { signal?: AbortSignal },
): Promise<RetriedResult> {
  const finish = (r: MathResult) => offerKnownReadings(req.input, keepRenderable(r, check));
  let first: MathResult;
  try {
    first = await resolver.resolve(req, opts);
  } catch (e) {
    if (!(e instanceof ModelOutputError)) throw e;
    // Say why: at temperature 0 the very same request returns the very same broken answer (S4).
    const again = await resolver.resolve({ ...req, retry: { latex: '', message: e.message } }, opts);
    return { result: finish(again), retried: { latex: '', message: e.message } };
  }
  if (first.status !== 'ok' && first.status !== 'ambiguous') return { result: finish(first) };
  const c = check(first.latex);
  if (c.ok) return { result: finish(first) };
  const retry = { latex: first.latex, message: c.message, position: c.position };
  const second = await resolver.resolve({ ...req, retry }, opts);
  return { result: finish(second), retried: { latex: first.latex, message: c.message } };
}

/** Drop alternatives and notations the renderer rejects: the chip would insert a broken formula. */
function keepRenderable(r: MathResult, check: LatexCheck): MathResult {
  const alternatives = r.alternatives.filter((a) => check(a.latex).ok);
  const notations = r.notations.filter((a) => check(a.latex).ok);
  const status = r.status === 'ambiguous' && alternatives.length === 0 ? 'ok' : r.status;
  return { ...r, status, alternatives, notations };
}
