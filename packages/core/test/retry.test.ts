import { describe, expect, it } from 'vitest';
import { resolveWithRetry, type LatexCheck } from '../src/ai/retry';
import { ModelOutputError, toMathResult } from '../src/ai/result';
import type { MathGenerateRequest, MathResolver } from '../src/ai/types';

/** Rejects anything using \abs, the way KaTeX does. */
const check: LatexCheck = (latex) =>
  latex.includes('\\abs') ? { ok: false, message: 'Undefined control sequence: \\abs', position: 0 } : { ok: true };

/** A resolver that answers from a script and records the requests it saw. */
function scripted(...answers: Record<string, unknown>[]) {
  const requests: MathGenerateRequest[] = [];
  const resolver: MathResolver = {
    async resolve(req) {
      requests.push(req);
      return toMathResult(answers[requests.length - 1] ?? {});
    },
    async edit() {
      throw new Error('not used');
    },
  };
  return { resolver, requests };
}

describe('resolveWithRetry', () => {
  it('does not retry an answer the renderer accepts', async () => {
    const s = scripted({ status: 'ok', latex: '|x|' });
    const r = await resolveWithRetry(s.resolver, { kind: 'generate', input: 'x 的绝对值' }, check);
    expect(r.result.latex).toBe('|x|');
    expect(r.retried).toBeUndefined();
    expect(s.requests).toHaveLength(1);
  });

  it('sends the renderer error back once', async () => {
    const s = scripted({ status: 'ok', latex: '\\abs{x}' }, { status: 'ok', latex: '|x|' });
    const r = await resolveWithRetry(s.resolver, { kind: 'generate', input: 'x 的绝对值' }, check);
    expect(r.result.latex).toBe('|x|');
    expect(r.retried).toEqual({ latex: '\\abs{x}', message: 'Undefined control sequence: \\abs' });
    expect(s.requests[1]!.retry).toEqual({ latex: '\\abs{x}', message: 'Undefined control sequence: \\abs', position: 0 });
  });

  it('returns the second answer even if it still fails, for the caller to judge', async () => {
    const s = scripted({ status: 'ok', latex: '\\abs{x}' }, { status: 'ok', latex: '\\abs{x}' });
    const r = await resolveWithRetry(s.resolver, { kind: 'generate', input: 'x 的绝对值' }, check);
    expect(r.result.latex).toBe('\\abs{x}');
    expect(s.requests).toHaveLength(2);
  });

  it('asks again once, saying why, when the answer was unusable', async () => {
    const requests: MathGenerateRequest[] = [];
    const resolver: MathResolver = {
      async resolve(req) {
        requests.push(req);
        if (requests.length === 1) throw new ModelOutputError('model returned malformed JSON');
        return toMathResult({ status: 'ok', latex: '|x|' });
      },
      async edit() {
        throw new Error('not used');
      },
    };
    const r = await resolveWithRetry(resolver, { kind: 'generate', input: 'x 的绝对值' }, check);
    expect(r.result.latex).toBe('|x|');
    expect(r.retried).toEqual({ latex: '', message: 'model returned malformed JSON' });
    // The same request at temperature 0 would get the same broken answer back.
    expect(requests[1]!.retry).toEqual({ latex: '', message: 'model returned malformed JSON' });
  });

  it('does not retry transport errors', async () => {
    const resolver: MathResolver = {
      async resolve() {
        throw new Error('model endpoint 401');
      },
      async edit() {
        throw new Error('not used');
      },
    };
    await expect(resolveWithRetry(resolver, { kind: 'generate', input: 'x' }, check)).rejects.toThrow('401');
  });

  it('does not retry unsupported or not_math answers', async () => {
    const s = scripted({ status: 'unsupported', latex: '', features: ['tikz-cd'] });
    await resolveWithRetry(s.resolver, { kind: 'generate', input: '交换图' }, check);
    expect(s.requests).toHaveLength(1);
  });

  it('drops alternatives the renderer rejects, and the ambiguity with them', async () => {
    const s = scripted({ status: 'ambiguous', latex: '|x-2|', alternatives: [{ latex: '\\abs{x}-2', interpretation: '' }] });
    const r = await resolveWithRetry(s.resolver, { kind: 'generate', input: 'the absolute value of x minus 2' }, check);
    expect(r.result.alternatives).toEqual([]);
    expect(r.result.status).toBe('ok');
  });
});
