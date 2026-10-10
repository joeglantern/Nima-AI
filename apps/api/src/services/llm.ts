/**
 * The language model behind Ask Nima.
 *
 * It speaks the OpenAI chat format, which is what llama.cpp's server, vLLM
 * and every hosted provider expose, so the model can be swapped by changing
 * one environment variable.
 *
 * Two things matter more than which model is used:
 *
 *   1. **The model never invents products.** It picks filters; our code runs
 *      the search and returns real rows. A stylist that recommends things
 *      nobody sells is worse than no stylist.
 *   2. **It must degrade.** When the model is unreachable, Ask Nima still
 *      answers using the same search with filters pulled from the words in
 *      the message. Slower to read, but never broken.
 */

import type { Env } from '@nima/config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface CompletionChunk {
  text?: string;
  toolCall?: ToolCall;
  done?: boolean;
}

export class LlmUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The stylist model is not reachable');
    this.name = 'LlmUnavailableError';
    this.cause = cause;
  }
}

export interface LlmProvider {
  readonly model: string;
  available(): Promise<boolean>;
  /** Streams the reply so the app can show words as they arrive. */
  stream(request: CompletionRequest): AsyncGenerator<CompletionChunk>;
  complete(request: CompletionRequest): Promise<{ text: string; toolCalls: ToolCall[] }>;
}

interface StreamDelta {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export function createLlmProvider(env: Env): LlmProvider {
  const base = env.LLM_BASE_URL.replace(/\/$/, '');

  async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw new LlmUnavailableError(`${response.status} ${await response.text()}`);
    }

    return response;
  }

  return {
    model: env.LLM_MODEL,

    async available() {
      try {
        const response = await fetch(`${base}/models`, {
          signal: AbortSignal.timeout(2_000),
          headers: { authorization: `Bearer ${env.LLM_API_KEY}` },
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async *stream(request) {
      let response: Response;

      try {
        response = await post(
          {
            model: env.LLM_MODEL,
            messages: request.messages,
            ...(request.tools ? { tools: request.tools, tool_choice: 'auto' } : {}),
            max_tokens: request.maxTokens ?? 400,
            temperature: request.temperature ?? 0.6,
            stream: true,
          },
          request.signal,
        );
      } catch (error) {
        throw new LlmUnavailableError(error);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new LlmUnavailableError('No response body');

      const decoder = new TextDecoder();
      const pending = new Map<number, { id: string; name: string; args: string }>();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            // Flush any tool call that was assembled across chunks.
            for (const call of pending.values()) {
              yield {
                toolCall: {
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.args },
                },
              };
            }
            yield { done: true };
            return;
          }

          let parsed: StreamDelta;
          try {
            parsed = JSON.parse(payload) as StreamDelta;
          } catch {
            continue;
          }

          const choice = parsed.choices?.[0];
          const text = choice?.delta?.content;
          if (text) yield { text };

          for (const call of choice?.delta?.tool_calls ?? []) {
            const existing = pending.get(call.index) ?? { id: '', name: '', args: '' };
            pending.set(call.index, {
              id: call.id ?? existing.id,
              name: call.function?.name ?? existing.name,
              args: existing.args + (call.function?.arguments ?? ''),
            });
          }
        }
      }

      yield { done: true };
    },

    async complete(request) {
      const response = await post(
        {
          model: env.LLM_MODEL,
          messages: request.messages,
          ...(request.tools ? { tools: request.tools, tool_choice: 'auto' } : {}),
          max_tokens: request.maxTokens ?? 400,
          temperature: request.temperature ?? 0.6,
        },
        request.signal,
      );

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
      };

      const message = body.choices?.[0]?.message;

      return {
        text: message?.content ?? '',
        toolCalls: message?.tool_calls ?? [],
      };
    },
  };
}
