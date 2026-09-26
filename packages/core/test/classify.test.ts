import { describe, expect, it } from 'vitest';
import { classifyIntent } from '../src/intent/classify';
import { intentCorpus } from './intent.corpus';

describe('classifyIntent corpus', () => {
  for (const c of intentCorpus) {
    it(`${JSON.stringify(c.input)} → ${c.decision}${c.kind ? ` (${c.kind})` : ''}`, () => {
      const r = classifyIntent(c.input);
      expect(r.decision, `reasons: ${r.reasons.join(', ')}`).toBe(c.decision);
      if (c.kind) expect(r.kind, `reasons: ${r.reasons.join(', ')}`).toBe(c.kind);
      if (c.latex !== undefined) expect(r.latex).toBe(c.latex);
      if (c.display) expect(r.display).toBe(c.display);
    });
  }
});

describe('classifyIntent invariants', () => {
  it('never inserts CJK directly', () => {
    for (const c of intentCorpus) {
      const r = classifyIntent(c.input);
      if (r.decision === 'direct') expect(/\p{Script=Han}/u.test(r.latex ?? '')).toBe(false);
    }
  });

  it('direct results always carry latex and display', () => {
    for (const c of intentCorpus) {
      const r = classifyIntent(c.input);
      if (r.decision === 'direct') {
        expect(r.latex).toBeTruthy();
        expect(r.display).toBeDefined();
      }
    }
  });

  it('source mode makes everything literal', () => {
    const r = classifyIntent('sin x', { sourceMode: true });
    expect(r.decision).toBe('direct');
    expect(r.latex).toBe('sin x');
  });

  it('extra keywords widen the informal set', () => {
    expect(classifyIntent('dx').decision).toBe('direct');
    expect(classifyIntent('dx', { extraKeywords: ['dx'] }).decision).toBe('ai');
  });

  it('is deterministic', () => {
    for (const c of intentCorpus) {
      expect(classifyIntent(c.input)).toEqual(classifyIntent(c.input));
    }
  });
});
