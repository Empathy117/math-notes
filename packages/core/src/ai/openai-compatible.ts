/**
 * MathResolver for any OpenAI-compatible chat endpoint. DeepSeek is the default
 * (design decision 4, 2026-09-26): JSON output mode plus the schema in the prompt,
 * with the host's validation pipeline as the final judge.
 *
 * Never put an API key in client-side code you ship; for the playground a key is
 * read from an env variable at dev time only.
 */
import { buildEditMessages, buildGenerateMessages, buildScanMessages, type ChatMessage } from './prompt';
import { ModelOutputError, parseMathEditResultText, parseMathResultText, parseMathScanResultText } from './result';
import type {
  MathEditRequest,
  MathEditResult,
  MathGenerateRequest,
  MathResolver,
  MathResult,
  MathScanRequest,
  MathScanResult,
} from './types';

export interface OpenAICompatibleOptions {
  apiKey: string;
  /** Model id, e.g. the DeepSeek flash-class model you tested. */
  model: string;
  /** Base URL without the trailing path, e.g. "https://api.deepseek.com". */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Use `response_format: {type: "json_object"}` (DeepSeek and OpenAI support it). */
  jsonMode?: boolean;
  /** Vendor-specific fields merged into the request body, e.g. DeepSeek's `thinking`. */
  extraBody?: Record<string, unknown>;
  fetch?: typeof fetch;
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: unknown;
}

export class OpenAICompatibleResolver implements MathResolver {
  private readonly opts: Required<Omit<OpenAICompatibleOptions, 'fetch'>> & { fetch: typeof fetch };

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = {
      baseUrl: 'https://api.deepseek.com',
      temperature: 0,
      // A cap, not a cost: eight Maxwell equations already take ~400 tokens (S4), and a cut-off
      // answer asked again comes back just as long.
      maxTokens: 1200,
      timeoutMs: 20_000,
      jsonMode: true,
      extraBody: {},
      ...opts,
      fetch: opts.fetch ?? globalThis.fetch.bind(globalThis),
    };
  }

  async resolve(req: MathGenerateRequest, o?: { signal?: AbortSignal }): Promise<MathResult> {
    const text = await this.chat(buildGenerateMessages(req), o?.signal);
    return parseMathResultText(text);
  }

  async edit(req: MathEditRequest, o?: { signal?: AbortSignal }): Promise<MathEditResult> {
    const text = await this.chat(buildEditMessages(req), o?.signal);
    return parseMathEditResultText(text, req.selectionLatex);
  }

  /** A scan answers with one span per description found, so it gets more room than one formula. */
  async scan(req: MathScanRequest, o?: { signal?: AbortSignal }): Promise<MathScanResult> {
    const text = await this.chat(buildScanMessages(req), o?.signal, Math.max(this.opts.maxTokens, 2400));
    return parseMathScanResultText(text);
  }

  private async chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens = this.opts.maxTokens): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.opts.timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.opts.fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // An empty key means a dev proxy injects the Authorization header server-side.
          ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages,
          temperature: this.opts.temperature,
          max_tokens: maxTokens,
          ...(this.opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          ...this.opts.extraBody,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`model endpoint ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as ChatCompletion;
      const choice = data.choices?.[0];
      // A cut-off JSON object would otherwise reach the one-line-LaTeX fallback and be
      // inserted as a formula.
      if (choice?.finish_reason === 'length') throw new ModelOutputError('model output truncated (finish_reason=length)');
      const content = choice?.message?.content;
      if (typeof content !== 'string') throw new Error('model endpoint returned no content');
      return content;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * deepseek-flash thinks by default (effort high). Thinking mode ignores temperature, its
 * reasoning tokens count against max_tokens, and the first answer token comes after the
 * reasoning (S4), so D6's non-reasoning mode is requested explicitly. Pass
 * `extraBody: { thinking: { type: 'enabled' } }` to opt back in.
 */
export function createDeepSeekResolver(opts: Omit<OpenAICompatibleOptions, 'baseUrl'> & { baseUrl?: string }): MathResolver {
  return new OpenAICompatibleResolver({
    baseUrl: 'https://api.deepseek.com',
    ...opts,
    extraBody: { thinking: { type: 'disabled' }, ...opts.extraBody },
  });
}
