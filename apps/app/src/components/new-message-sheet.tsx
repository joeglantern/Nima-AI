/**
 * Starting a conversation: find someone, open the thread.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { api } from '../lib/api';
import { useTheme } from '../theme/index';
import { Avatar } from './feed-post';
import { Sheet } from './sheet';
import { BodyStrong, Caption } from './text';

export function NewMessageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors, radius } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const people = useQuery({
    queryKey: ['people', debounced],
    queryFn: () => api.people(debounced || undefined),
    enabled: open,
  });

  const start = useMutation({
    mutationFn: (userId: string) => api.openConversation(userId),
    onSuccess: ({ id }) => {
      onClose();
      router.push({ pathname: '/messages/[id]', params: { id } });
    },
  });

  const items = people.data?.items ?? [];

  return (
    <Sheet open={open} onClose={onClose} title="New message">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or @handle"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        style={{
          fontFamily: 'DMSans_400Regular',
          fontSize: 15,
          color: colors.ink,
          paddingHorizontal: 16,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: colors.sunk,
        }}
        accessibilityLabel="Search people"
      />

      {people.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
      ) : items.length === 0 ? (
        <Caption align="center" style={{ paddingVertical: 16 }}>
          {debounced ? 'Nobody by that name' : 'Search for someone to message'}
        </Caption>
      ) : (
        <View>
          {items.slice(0, 12).map((person) => (
            <Pressable
              key={person.id}
              onPress={() => start.mutate(person.id)}
              disabled={start.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Message ${person.displayName}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Avatar url={person.avatar?.url} name={person.displayName} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <BodyStrong numberOfLines={1} style={{ fontSize: 15 }}>
                  {person.displayName}
                </BodyStrong>
                <Caption numberOfLines={1}>{`@${person.handle}`}</Caption>
              </View>
              {start.isPending && start.variables === person.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}
