/**
 * Behaviour events.
 *
 * Everything the feed learns from and everything a seller sees comes from
 * this one table. Writing is fire and forget: a failed event must never fail
 * the request that produced it.
 *
 * Guests are tracked by an anonymous id so the For You page can personalise
 * before anyone signs up, which the brief asks for.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EventType, Platform } from '@nima/db';

export interface RecordEventInput {
  request: FastifyRequest;
  type: EventType;
  entityType: 'product' | 'look' | 'store' | 'profile' | 'search' | 'thread';
  entityId: string;
  storeId?: string | null;
  props?: Record<string, unknown>;
}

function platformOf(request: FastifyRequest): Platform | null {
  const header = request.headers['x-nima-platform'];
  const value = Array.isArray(header) ? header[0] : header;

  if (value === 'ios') return 'IOS';
  if (value === 'android') return 'ANDROID';
  if (value === 'web') return 'WEB';
  return null;
}

export async function recordEvent(app: FastifyInstance, input: RecordEventInput): Promise<void> {
  const { request } = input;
  const anonHeader = request.headers['x-nima-anon-id'];
  const anonId = Array.isArray(anonHeader) ? anonHeader[0] : anonHeader;

  try {
    await app.prisma.event.create({
      data: {
        userId: request.user?.id ?? null,
        anonId: request.user ? null : (anonId ?? null),
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        storeId: input.storeId ?? null,
        props: (input.props ?? {}) as never,
        platform: platformOf(request),
        sessionId: request.id,
      },
    });
  } catch (error) {
    app.log.debug({ err: error }, 'Could not record an event');
  }
}
