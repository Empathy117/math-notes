import { describe, expect, it } from 'vitest';
import { OpenAICompatibleResolver, createDeepSeekResolver } from '../src/ai/openai-compatible';
import { ModelOutputError } from '../src/ai/result';

const OK_JSON = '{"interpretation":"x 的平方","status":"ok","latex":"x^{2}","alternatives":[],"features":[],"confidence":"high","consistency":{"kind":"none","expected":null},"notes":""}';

/** A fetch that records request bodies and answers with one chat completion. */
function fakeFetch(content: string, finishReason = 'stop') {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

describe('OpenAICompatibleResolver', () => {
  it('sends no vendor fields unless asked', async () => {
    const f = fakeFetch(OK_JSON);
    await new OpenAICompatibleResolver({ apiKey: 'k', model: 'm', fetch: f.fetch }).resolve({ kind: 'generate', input: 'x的平方' });
    expect(f.bodies[0]).not.toHaveProperty('thinking');
    expect(f.bodies[0]).toMatchObject({ model: 'm', temperature: 0, response_format: { type: 'json_object' } });
  });

  it('rejects output cut off by max_tokens instead of parsing the fragment', async () => {
    const f = fakeFetch('{"interpretation":"a divided by the quantity b plus c","', 'length');
    const r = new OpenAICompatibleResolver({ apiKey: 'k', model: 'm', fetch: f.fetch });
    await expect(r.resolve({ kind: 'generate', input: 'a over b plus c' })).rejects.toThrow(ModelOutputError);
  });
});

describe('createDeepSeekResolver', () => {
  it('turns thinking off by default', async () => {
    const f = fakeFetch(OK_JSON);
    const r = await createDeepSeekResolver({ apiKey: 'k', model: 'deepseek-flash', fetch: f.fetch }).resolve({ kind: 'generate', input: 'x的平方' });
    expect(f.bodies[0]).toMatchObject({ thinking: { type: 'disabled' } });
    expect(r.latex).toBe('x^{2}');
  });

  it('lets the caller opt back into thinking and add fields', async () => {
    const f = fakeFetch(OK_JSON);
    await createDeepSeekResolver({
      apiKey: 'k',
      model: 'deepseek-flash',
      fetch: f.fetch,
      extraBody: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
    }).resolve({ kind: 'generate', input: 'x的平方' });
    expect(f.bodies[0]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low' });
  });
});
