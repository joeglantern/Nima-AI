/**
 * Somebody's page.
 *
 * Who they are and what they have shared, in that order. No follower
 * counts anywhere: the brief is explicit that they are never public. A
 * private account shows its name and nothing else to a stranger, and says
 * so plainly rather than showing an empty grid.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { LookCard } from '../../src/components/cards';
import { EmptyState } from '../../src/components/empty-state';
import { Chip, ProfileHeader } from '../../src/components/profile-header';
import { ReportSheet, type ReportTarget } from '../../src/components/report-sheet';
import { Sheet } from '../../src/components/sheet';
import { Body, BodyStrong, Caption, Micro } from '../../src/components/text';
import { ApiError, api } from '../../src/lib/api';
import { shareProfile } from '../../src/lib/share';
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
  const signedIn = Boolean(bootstrap.data?.user && !bootstrap.data.user.isAnonymous);
  const { requireAccount } = useAuthGate();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);

  useEffect(() => {
    setFollowing(Boolean(person.data?.isFollowing));
  }, [person.data?.isFollowing]);

  const follow = useMutation({
    mutationFn: (next: boolean) => api.follow(String(handle), next),
    onMutate: (next) => setFollowing(next),
    onError: (_error, next) => setFollowing(!next),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['person', handle] });
      void queryClient.invalidateQueries({ queryKey: ['person-looks', handle] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const message = useMutation({
    mutationFn: () => api.openConversation(String(person.data?.id)),
    onSuccess: ({ id }) => router.push({ pathname: '/messages/[id]', params: { id } }),
  });

  const block = useMutation({
    mutationFn: () => api.block(String(handle), true),
    onSuccess: () => {
      setMenu(false);
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      router.canGoBack() ? router.back() : router.replace('/');
    },
  });

  const gated = (action: () => void, reason: string) => () => {
    if (!signedIn) requireAccount(reason);
    else action();
  };

  if (person.isError) {
    const gone = person.error instanceof ApiError && person.error.status === 404;
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground, paddingTop: insets.top }}>
        <Header onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <EmptyState
          art="person"
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
              <View style={{ marginHorizontal: -gutter, paddingBottom: 18 }}>
                <ProfileHeader
                  banner={profile.banner?.url ?? null}
                  avatar={profile.avatar?.url ?? null}
                  name={profile.displayName}
                  handle={profile.handle}
                  bio={profile.bio}
                  link={profile.link}
                  onLink={() => void Linking.openURL(profile.link ?? '')}
                  stats={profile.stats}
                  faces={
                    profile.knownFollowers && !isMe
                      ? {
                          people: profile.knownFollowers.people.map((person) => ({
                            key: person.handle,
                            url: person.avatar?.url,
                            name: person.displayName,
                          })),
                          label: knownLine(profile.knownFollowers),
                        }
                      : null
                  }
                  primary={
                    isMe
                      ? { label: 'Edit profile', onPress: () => router.push('/profile') }
                      : {
                          label: following ? 'Following' : 'Follow',
                          variant: following ? 'quiet' : 'primary',
                          onPress: gated(
                            () => follow.mutate(!following),
                            `Create an account to follow ${profile.displayName}`,
                          ),
                        }
                  }
                  secondary={
                    isMe
                      ? {
                          label: 'Share',
                          onPress: () => void shareProfile(profile.handle, profile.displayName),
                        }
                      : {
                          label: 'Message',
                          loading: message.isPending,
                          onPress: gated(
                            () => message.mutate(),
                            `Create an account to message ${profile.displayName}`,
                          ),
                        }
                  }
                  onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                  onMore={!isMe && signedIn ? () => setMenu(true) : undefined}
                >
                  {profile.store ? (
                    <Chip
                      label={
                        profile.store.verified
                          ? `${profile.store.name}, verified seller`
                          : profile.store.name
                      }
                      onPress={() =>
                        profile.store &&
                        router.push({ pathname: '/s/[slug]', params: { slug: profile.store.slug } })
                      }
                    />
                  ) : null}
                </ProfileHeader>

                {profile.isPrivate && !isMe ? (
                  <View
                    style={{
                      marginTop: 18,
                      marginHorizontal: gutter,
                      padding: 16,
                      borderRadius: radius.card,
                      backgroundColor: colors.surface,
                      alignItems: 'center',
                      gap: 4,
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
            ) : undefined
          }
          ListFooterComponent={
            looks.isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
            ) : undefined
          }
        />
      </View>

      <Sheet
        open={menu}
        onClose={() => setMenu(false)}
        title={profile ? `@${profile.handle}` : undefined}
      >
        <BodyStrong>{`Block ${profile?.displayName ?? 'them'}?`}</BodyStrong>
        <Caption>
          They will not be able to find your profile, see your looks or message you. Nima does not
          tell them.
        </Caption>
        <Button label="Block" loading={block.isPending} onPress={() => block.mutate()} />
        <Button
          label="Report instead"
          variant="quiet"
          onPress={() => {
            setMenu(false);
            setReporting({ kind: 'person', handle: String(handle) });
          }}
        />
        <Button label="Cancel" variant="quiet" onPress={() => setMenu(false)} />
      </Sheet>

      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </>
  );
}

/** "Followed by Amani", "Followed by Amani and Wanjiru", "Followed by Amani and 3 others you follow". */
function knownLine(known: { people: Array<{ displayName: string }>; others: number }): string {
  const names = known.people.map((p) => p.displayName.split(' ')[0]);
  if (known.others > 0) {
    return `Followed by ${names.join(', ')} and ${known.others} ${known.others === 1 ? 'other' : 'others'} you follow`;
  }
  return `Followed by ${names.join(' and ')}`;
}

function Header({ onBack, onMore }: { onBack: () => void; onMore?: () => void }) {
  const { colors, gutter } = useTheme();

  return (
    <View
      style={{
        paddingHorizontal: gutter,
        paddingTop: 12,
        paddingBottom: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
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
      {onMore ? (
        <Pressable
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel="More"
          hitSlop={8}
          style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path
              d="M5 12h.01M12 12h.01M19 12h.01"
              stroke={colors.ink}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      ) : null}
    </View>
  );
}
