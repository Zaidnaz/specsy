/**
 * Token accounting for specs.
 *
 * Why this exists: a spec is not read once. An agent re-reads it on every turn
 * of the loop, so its size is a *recurring* context cost. A 15k-token change
 * across an eight-turn implementation is 120k tokens of context before the
 * agent has written a line of code. Spec quality includes spec economy, and
 * this is the only part of the bill specsy can actually see.
 *
 * What specsy cannot see: the agent's own token usage. That belongs to the
 * host (Claude Code, Cursor) and its API account, not to a linter. Everything
 * here measures the *specs* and specsy's own output, and says so.
 *
 * On accuracy: Claude's tokenizer is not public, and OpenAI tokenizers
 * (tiktoken, gpt-tokenizer) undercount Claude by roughly 15-20% on prose and
 * much more on code, so shipping one would be worse than an honest heuristic.
 * The default is a labelled estimate with no dependency and no network. Pass
 * an API key and `exact: true` to get real counts from the count_tokens
 * endpoint instead.
 */

/** Per-million-token input prices, in USD. */
export const INPUT_PRICE_PER_MTOK: Record<string, number> = {
  "claude-opus-5": 5,
  "claude-sonnet-5": 2,
  "claude-haiku-4-5": 1,
};

export const DEFAULT_MODEL = "claude-opus-5";

export interface TokenCount {
  tokens: number;
  /** True when the number came from the count_tokens endpoint. */
  exact: boolean;
  /** Model the count applies to. Token counts are model-specific. */
  model: string;
}

/**
 * Local estimate, no network.
 *
 * Blends two signals because neither alone survives markdown: characters over
 * four is the usual rule of thumb but undercounts identifier-dense text, while
 * word count times 1.3 undercounts punctuation and code. Taking the larger
 * keeps the estimate from reading low, which is the direction that would
 * mislead someone budgeting context.
 *
 * Treat the result as +/-15%. It is for relative comparison and rough
 * budgeting, not billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const byChars = text.length / 4;
  const words = text.split(/\s+/).filter(Boolean).length;
  const byWords = words * 1.3;
  return Math.max(1, Math.round(Math.max(byChars, byWords)));
}

/**
 * Exact counts from the Anthropic API. Requires credentials and a network
 * call, so it is never the default. Returns undefined when the SDK is absent
 * or no credential is configured, letting the caller fall back to the
 * estimate rather than fail the run.
 */
export async function countTokensExact(
  text: string,
  model: string = DEFAULT_MODEL,
): Promise<number | undefined> {
  try {
    const mod = await import("@anthropic-ai/sdk").catch(() => undefined);
    if (!mod) return undefined;
    const Anthropic = mod.default;
    const client = new Anthropic();
    const res = await client.messages.countTokens({
      model,
      messages: [{ role: "user", content: text }],
    });
    return res.input_tokens;
  } catch {
    // No credentials, offline, or a rejected request: the estimate stands in.
    return undefined;
  }
}

export async function countTokens(
  text: string,
  opts: { exact?: boolean; model?: string } = {},
): Promise<TokenCount> {
  const model = opts.model ?? DEFAULT_MODEL;
  if (opts.exact) {
    const n = await countTokensExact(text, model);
    if (n !== undefined) return { tokens: n, exact: true, model };
  }
  return { tokens: estimateTokens(text), exact: false, model };
}

/** Input cost in USD of feeding `tokens` to `model` once. */
export function inputCost(tokens: number, model: string = DEFAULT_MODEL): number {
  const rate = INPUT_PRICE_PER_MTOK[model] ?? INPUT_PRICE_PER_MTOK[DEFAULT_MODEL]!;
  return (tokens / 1_000_000) * rate;
}

/** `14200` -> `14.2k`. Keeps wide tables readable. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

/**
 * What specsy has put into the agent's context this session.
 *
 * An MCP server is a long-lived process, so it can honestly account for its
 * own contribution: how many times the agent called it, and how many tokens
 * of output it handed back. That is the part of the loop's cost specsy is
 * responsible for, and the part it can measure without guessing.
 */
export class SessionUsage {
  private calls = new Map<string, number>();
  private returnedTokens = 0;
  readonly startedAt = Date.now();

  record(tool: string, responseText: string): void {
    this.calls.set(tool, (this.calls.get(tool) ?? 0) + 1);
    this.returnedTokens += estimateTokens(responseText);
  }

  get totalCalls(): number {
    return [...this.calls.values()].reduce((a, b) => a + b, 0);
  }

  get tokensReturned(): number {
    return this.returnedTokens;
  }

  byTool(): { tool: string; calls: number }[] {
    return [...this.calls.entries()]
      .map(([tool, calls]) => ({ tool, calls }))
      .sort((a, b) => b.calls - a.calls);
  }

  summary(model: string = DEFAULT_MODEL): string {
    if (this.totalCalls === 0) return "specsy has not been called yet this session.";
    const mins = Math.max(1, Math.round((Date.now() - this.startedAt) / 60_000));
    const breakdown = this.byTool().map((e) => `${e.tool} x${e.calls}`).join(", ");
    return [
      `${this.totalCalls} specsy call(s) over ~${mins} min: ${breakdown}.`,
      `specsy has added ~${formatTokens(this.returnedTokens)} tokens to this conversation`,
      `(~${formatCost(inputCost(this.returnedTokens, model))} at ${model} input rates, estimated).`,
    ].join(" ");
  }
}
