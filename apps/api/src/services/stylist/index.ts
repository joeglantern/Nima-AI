/**
 * Ask Nima.
 *
 * The loop: build context, let the model call tools, stream the reply to the
 * phone over the WebSocket, save the turn.
 *
 * When the model is unreachable, the same question is still answered from the
 * catalogue using filters read out of the sentence. The wording is plainer,
 * but a shopper asking for a wedding outfit under 5,000 still gets one. A
 * stylist that returns an error is useless; a stylist that is briefly less
 * articulate is not.
 */

import type { ServerFrame } from '@nima/contracts';
import type { FastifyInstance } from 'fastify';
import { type ChatMessage, type LlmProvider, LlmUnavailableError } from '../llm.js';
import { answerWithoutModel } from './fallback.js';
import { describeShopper, NIMA_PERSONA } from './prompt.js';
import { runStylistTool, STYLIST_TOOLS } from './tools.js';

/** Two rounds of tools is enough for search, then build. More is a loop. */
const MAX_TOOL_ROUNDS = 3;

export interface AskInput {
  userId: string;
  threadId?: string;
  message: string;
  context?: {
    productId?: string;
    lookId?: string;
    wardrobeItemId?: string;
    occasion?: string;
  };
}

export interface AskResult {
  threadId: string;
  messageId: string;
}

export class StylistService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly llm: LlmProvider,
  ) {}

  async ask(input: AskInput): Promise<AskResult> {
    const { app } = this;

    const thread = input.threadId
      ? await app.prisma.stylistThread.findFirst({
          where: { id: input.threadId, userId: input.userId },
        })
      : null;

    const activeThread =
      thread ??
      (await app.prisma.stylistThread.create({
        data: {
          userId: input.userId,
          // The first message makes a better title than anything generated.
          title: input.message.slice(0, 60),
        },
      }));

    await app.prisma.stylistMessage.create({
      data: { threadId: activeThread.id, role: 'USER', content: input.message },
    });

    // The reply streams in the background: the HTTP request returns as soon
    // as the turn is accepted.
    void this.respond(input, activeThread.id).catch((error: unknown) => {
      app.log.error({ err: error, threadId: activeThread.id }, 'Ask Nima failed');
    });

    return { threadId: activeThread.id, messageId: activeThread.id };
  }

  private async respond(input: AskInput, threadId: string): Promise<void> {
    const { app } = this;
    const send = (frame: ServerFrame) => app.realtime.toUser(input.userId, frame);

    const history = await this.buildMessages(input, threadId);

    let reply = '';
    const productIds: string[] = [];
    let lookId: string | undefined;

    try {
      const messages = [...history];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        let roundText = '';
        const calls: Array<{ id: string; name: string; args: string }> = [];

        for await (const chunk of this.llm.stream({ messages, tools: STYLIST_TOOLS })) {
          if (chunk.text) {
            roundText += chunk.text;
            await send({ type: 'stylist.delta', threadId, text: chunk.text });
          }

          if (chunk.toolCall) {
            calls.push({
              id: chunk.toolCall.id,
              name: chunk.toolCall.function.name,
              args: chunk.toolCall.function.arguments,
            });
          }
        }

        reply += roundText;

        if (calls.length === 0) break;

        messages.push({
          role: 'assistant',
          content: roundText,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.args },
          })),
        });

        for (const call of calls) {
          await send({
            type: 'stylist.tool',
            threadId,
            tool: call.name,
            note: noteFor(call.name),
          });

          const result = await runStylistTool(app, input.userId, call.name, call.args);
          productIds.push(...result.productIds);
          if (result.lookId) lookId = result.lookId;

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: result.forModel,
          });
        }
      }
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;

      app.log.warn('The stylist model is unreachable, answering from the catalogue');

      const fallback = await answerWithoutModel(app, input);
      reply = fallback.text;
      productIds.push(...fallback.productIds);

      await send({ type: 'stylist.delta', threadId, text: reply });
    }

    const saved = await app.prisma.stylistMessage.create({
      data: {
        threadId,
        role: 'ASSISTANT',
        content: reply.trim() || 'Let me look again. Tell me the occasion and your budget.',
        refs: { productIds: [...new Set(productIds)].slice(0, 12), lookId: lookId ?? null },
      },
    });

    await app.prisma.stylistThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    await send({ type: 'stylist.done', threadId, messageId: saved.id });
  }

  /** The system prompt, what we know about the shopper, then the history. */
  private async buildMessages(input: AskInput, threadId: string): Promise<ChatMessage[]> {
    const { app } = this;

    const [style, wardrobe, profile, photo, previous] = await Promise.all([
      app.prisma.styleProfile.findUnique({ where: { userId: input.userId } }),
      app.prisma.wardrobeItem.findMany({ where: { userId: input.userId }, take: 20 }),
      app.prisma.profile.findUnique({ where: { userId: input.userId } }),
      app.prisma.userPhoto.findFirst({ where: { userId: input.userId }, select: { id: true } }),
      app.prisma.stylistMessage.findMany({
        where: { threadId, role: { in: ['USER', 'ASSISTANT'] } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const messages: ChatMessage[] = [
      { role: 'system', content: NIMA_PERSONA },
      {
        role: 'system',
        content: describeShopper({
          displayName: profile?.displayName ?? null,
          style,
          wardrobe,
          credits: 0,
          hasPhoto: Boolean(photo),
        }),
      },
    ];

    // Oldest first, and the newest user message is already in there.
    for (const message of previous.reverse()) {
      messages.push({
        role: message.role === 'USER' ? 'user' : 'assistant',
        content: message.content,
      });
    }

    if (input.context?.productId) {
      const product = await app.prisma.product.findUnique({
        where: { id: input.context.productId },
        select: { id: true, title: true, category: true, priceFromCents: true },
      });

      if (product) {
        messages.push({
          role: 'system',
          content: `They are looking at: ${product.id} | ${product.title} | KSh ${Math.round(product.priceFromCents / 100)}`,
        });
      }
    }

    return messages;
  }
}

function noteFor(tool: string): string {
  switch (tool) {
    case 'search_products':
      return 'Looking through the shop';
    case 'search_wardrobe':
      return 'Checking your wardrobe';
    case 'build_outfit':
      return 'Putting a look together';
    default:
      return 'Working on it';
  }
}
