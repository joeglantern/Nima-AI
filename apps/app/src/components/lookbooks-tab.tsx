/**
 * Lookbooks, inside the profile.
 *
 * A set of looks kept together: a trip, a wedding week, a capsule for the
 * season. Making one is the only thing this screen does, because a
 * lookbook fills up from everywhere else in the app rather than from here.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../lib/api';
import { useTheme } from '../theme/index';
import { Button } from './button';
import { Sheet } from './sheet';
import { Body, BodyStrong, Caption, Micro } from './text';

export function LookbooksTab() {
  const { colors, gutter, radius } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');

  const lookbooks = useQuery({ queryKey: ['lookbooks'], queryFn: () => api.lookbooks({}) });

  const create = useMutation({
    mutationFn: () => api.createLookbook({ title: title.trim() }),
    onSuccess: async (made) => {
      setNaming(false);
      setTitle('');
      await queryClient.invalidateQueries({ queryKey: ['lookbooks'] });
      router.push({ pathname: '/lookbook/[id]', params: { id: made.id } });
    },
  });

  const items = lookbooks.data?.items ?? [];

  return (
    <View style={{ paddingHorizontal: gutter, paddingTop: 20, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <BodyStrong>Sets you have put together</BodyStrong>
        <Caption>
          A trip, a wedding week, a capsule for the season. Add looks to one from anywhere in the
          app.
        </Caption>
      </View>

      {lookbooks.isLoading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {items.map((book) => (
            <Pressable
              key={book.id}
              onPress={() => router.push({ pathname: '/lookbook/[id]', params: { id: book.id } })}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: 12,
                borderRadius: radius.card,
                backgroundColor: pressed ? colors.sunk : colors.surface,
              })}
            >
              <View
                style={{
                  width: 56,
                  height: 72,
                  borderRadius: 12,
                  overflow: 'hidden',
                  backgroundColor: colors.sunk,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {book.cover ? (
                  <Image
                    source={{ uri: book.cover.url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                ) : (
                  <Svg width={22} height={22} viewBox="0 0 24 24">
                    <Path
                      d="M12 7c-1.8-1.3-4.3-1.8-7-1.5v11c2.7-.3 5.2.2 7 1.5 1.8-1.3 4.3-1.8 7-1.5v-11c-2.7-.3-5.2.2-7 1.5Zm0 0v11"
                      stroke={colors.line}
                      strokeWidth={1.6}
                      fill="none"
                      strokeLinejoin="round"
                    />
                  </Svg>
                )}
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Body numberOfLines={1}>{book.title}</Body>
                <Micro>
                  {book.entryCount === 0
                    ? 'Nothing in it yet'
                    : `${book.entryCount} ${book.entryCount === 1 ? 'piece' : 'pieces'}`}
                </Micro>
                {book.occasion ? <Micro>{book.occasion}</Micro> : null}
              </View>

              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path
                  d="m10 6 6 6-6 6"
                  stroke={colors.muted}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </Pressable>
          ))}

          <Button label="Start a lookbook" variant="quiet" onPress={() => setNaming(true)} />
        </View>
      )}

      <Sheet open={naming} onClose={() => setNaming(false)} title="Start a lookbook">
        <Caption>Name it after the occasion. You can change it later.</Caption>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Naivasha weekend"
          placeholderTextColor={colors.muted}
          autoFocus
          maxLength={60}
          style={{
            marginTop: 14,
            backgroundColor: colors.surface,
            borderRadius: radius.image,
            borderWidth: 1,
            borderColor: colors.line,
            paddingHorizontal: 16,
            paddingVertical: 14,
            fontFamily: 'DMSans_400Regular',
            fontSize: 16,
            color: colors.ink,
          }}
          accessibilityLabel="Lookbook name"
        />

        <View style={{ marginTop: 16 }}>
          <Button
            label="Create it"
            loading={create.isPending}
            disabled={title.trim().length < 1}
            onPress={() => create.mutate()}
          />
        </View>
      </Sheet>
    </View>
  );
}
