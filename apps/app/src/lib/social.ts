/**
 * The small pieces of social state more than one screen needs.
 *
 * Unread counts live in one query that the socket nudges, so the bell, the
 * inbox and the sidebar all agree without each polling on its own.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useServerFrame } from './realtime';

/** Whether someone with a real account is signed in. Guests are not. */
export function useSignedIn(): boolean {
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  return Boolean(bootstrap.data?.user && !bootstrap.data.user.isAnonymous);
}

export function useUnread(): { activity: number; messages: number } {
  const signedIn = useSignedIn();
  const queryClient = useQueryClient();

  const unread = useQuery({
    queryKey: ['unread'],
    queryFn: api.unread,
    enabled: signedIn,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  useServerFrame('notification.new', () => {
    void queryClient.invalidateQueries({ queryKey: ['unread'] });
    void queryClient.invalidateQueries({ queryKey: ['activity'] });
  });

  useServerFrame('message.new', (frame) => {
    void queryClient.invalidateQueries({ queryKey: ['unread'] });
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['messages', frame.conversationId] });
  });

  return signedIn
    ? { activity: unread.data?.activity ?? 0, messages: unread.data?.messages ?? 0 }
    : { activity: 0, messages: 0 };
}
