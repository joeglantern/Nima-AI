/**
 * Somebody's page.
 *
 * Who they are and what they have shared, in that order. No follower
 * counts anywhere: the brief is explicit that they are never public. A
 * private account shows its name and nothing else to a stranger, and says
 * so plainly rather than showing an empty grid.
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Linking, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { LookCard } from '../../src/components/cards';
import { EmptyState } from '../../src/components/empty-state';
import { Body, Caption, Micro, Title } from '../../src/components/text';
import { ApiError, api } from '../../src/lib/api';
import { useTheme } from '../../src/theme/index';

export default function PersonScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { colors, gutter, radius, gridColumns, floatingClearance, isWide } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const person = useQuery({
    queryKey: ['person', handle],
    queryFn: () => api.profile(String(handle)),
    enabled: Boolean(handle),
    retry: false,
  });

  const looks = useInfiniteQuery({
    queryKey: ['person-looks', handle],
    queryFn: ({ pageParam }) =>
      api.profileLooks(String(handle), { cursor: pageParam ?? undefined, limit: 24 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: person.isSuccess,
  });

  const items = looks.data?.pages.flatMap((page) => page.items) ?? [];
  const columns = Math.min(gridColumns, 3);

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const isMe = Boolean(person.data && bootstrap.data?.user?.id === person.data.id);

  if (person.isError) {
    const gone = person.error instanceof ApiError && person.error.status === 404;
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground, paddingTop: insets.top }}>
        <Header onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <EmptyState
          art="sparkle"
          message={gone ? 'There is nobody by that handle.' : 'That page could not be loaded.'}
        />
      </View>
    );
  }

  const profile = person.data;

  return (
    <>
      <Stack.Screen options={{ title: profile ? `@${profile.handle}` : 'Profile' }} />

      <View
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground, paddingTop: insets.top }}
      >
        <Header onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />

        <FlatList
          data={profile?.isPrivate && !isMe ? [] : items}
          key={columns}
          numColumns={columns}
          keyExtractor={(look) => look.id}
          columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingBottom: floatingClearance,
            gap: 12,
            maxWidth: isWide ? 980 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (looks.hasNextPage && !looks.isFetchingNextPage) void looks.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <View style={{ flex: 1 / columns }}>
              <LookCard look={item} variant="grid" />
            </View>
          )}
          ListHeaderComponent={
            profile ? (
              <View style={{ alignItems: 'center', gap: 6, paddingTop: 6, paddingBottom: 18 }}>
                <View
                  style={{
                    width: 104,
                    height: 104,
                    borderRadius: 52,
                    overflow: 'hidden',
                    backgroundColor: colors.primarySoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {profile.avatar ? (
                    <Image
                      source={{ uri: profile.avatar.url }}
                      style={{ width: '100%', height: '100%' }}
                      contentFit="cover"
                      accessibilityLabel={`${profile.displayName}'s picture`}
                    />
                  ) : (
                    <Title style={{ fontSize: 40, lineHeight: 48, color: colors.primary }}>
                      {profile.displayName.trim().charAt(0).toUpperCase()}
                    </Title>
                  )}
                </View>

                <Title align="center" style={{ marginTop: 6 }}>
                  {profile.displayName}
                </Title>
                <Caption align="center">{`@${profile.handle}`}</Caption>

                {profile.bio ? (
                  <Body align="center" style={{ marginTop: 6, maxWidth: 420 }}>
                    {profile.bio}
                  </Body>
                ) : null}

                {profile.link ? (
                  <Pressable
                    onPress={() => void Linking.openURL(profile.link ?? '')}
                    accessibilityRole="link"
                    hitSlop={6}
                  >
                    <Caption tone="primary" align="center">
                      {profile.link.replace(/^https?:\/\//, '')}
                    </Caption>
                  </Pressable>
                ) : null}

                <View
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    marginTop: 10,
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                  }}
                >
                  {profile.store ? (
                    <Pill
                      label={
                        profile.store.verified
                          ? `${profile.store.name}, verified seller`
                          : profile.store.name
                      }
                      onPress={() => router.push({ pathname: '/store' })}
                    />
                  ) : null}
                  {isMe ? (
                    <Pill label="Edit profile" onPress={() => router.push('/profile')} />
                  ) : null}
                </View>

                {profile.isPrivate && !isMe ? (
                  <View
                    style={{
                      marginTop: 18,
                      padding: 16,
                      borderRadius: radius.card,
                      backgroundColor: colors.surface,
                      alignItems: 'center',
                      gap: 4,
                      alignSelf: 'stretch',
                    }}
                  >
                    <Body>This account is private</Body>
                    <Micro>Only people they approve see their looks</Micro>
                  </View>
                ) : null}
              </View>
            ) : (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            )
          }
          ListEmptyComponent={
            profile && !(profile.isPrivate && !isMe) && !looks.isLoading ? (
              <EmptyState
                art="hanger"
                message={isMe ? 'Looks you share will appear here' : 'Nothing shared yet'}
              />
            ) : null
          }
          ListFooterComponent={
            looks.isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
            ) : null
          }
        />
      </View>
    </>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  const { colors, gutter } = useTheme();

  return (
    <View style={{ paddingHorizontal: gutter, paddingTop: 12, paddingBottom: 8 }}>
      <Pressable
        onPress={onBack}
        accessibilityLabel="Back"
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.sunk,
        }}
      >
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            d="m14 6-6 6 6 6"
            stroke={colors.ink}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Pressable>
    </View>
  );
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.sunk : colors.surface,
      })}
    >
      <Caption tone="ink">{label}</Caption>
    </Pressable>
  );
}
