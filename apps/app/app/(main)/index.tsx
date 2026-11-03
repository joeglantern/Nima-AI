/**
 * For You.
 *
 * The main feed. It works without an account: a visitor sees looks ranked
 * from what they have tapped in this session, and the sign in sheet only
 * appears when they reach for something that needs to be theirs.
 *
 * It reads like the feeds people already scroll every day: occasion circles
 * across the top where stories would be, then one post after another, edge
 * to edge. The pieces, the comments and the try-on all open over the feed,
 * so nobody loses their place.
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { usePageTitle } from '../../src/lib/page-title';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Button } from '../../src/components/button';
import { ProductCard } from '../../src/components/cards';
import { EmptyState } from '../../src/components/empty-state';
import { FeedPost, FeedTile } from '../../src/components/feed-post';
import { PiecesSheet } from '../../src/components/feed-sheets';
import { InboxButtons } from '../../src/components/inbox-buttons';
import { OccasionTabs } from '../../src/components/occasion-tabs';
import { SendSheet, type SendTarget } from '../../src/components/send-sheet';
import { Body, BodyStrong, Caption, Heading } from '../../src/components/text';
import { TryOnResultSheet, useTryOn, useTryOnAvailable } from '../../src/components/try-on';
import { ApiError, api, type FeedItem } from '../../src/lib/api';
import { useTheme } from '../../src/theme/index';

type LookItem = Extract<FeedItem, { kind: 'look' }>;
type Row = FeedItem | { kind: 'pair'; first: LookItem; second: LookItem };

/**
 * One big look, then two side by side, like the pages of a magazine. Worked
 * out per page, so loading more never rearranges what is already on screen.
 */
function pace(items: FeedItem[]): Row[] {
  const rows: Row[] = [];
  let big = true;
  for (let at = 0; at < items.length; at++) {
    const item = items[at] as FeedItem;
    const next = items[at + 1];
    if (!big && item.kind === 'look' && next?.kind === 'look') {
      rows.push({ kind: 'pair', first: item, second: next });
      at += 1;
      big = true;
      continue;
    }
    rows.push(item);
    if (item.kind === 'look') big = false;
  }
  return rows;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function ForYouScreen() {
  usePageTitle('For You');
  const { colors, gutter, isWide, floatingClearance, radius } = useTheme();
  const router = useRouter();

  const [occasion, setOccasion] = useState<string | null>(null);
  const [piecesFor, setPiecesFor] = useState<string | null>(null);
  const [dressing, setDressing] = useState<string | null>(null);
  const [sending, setSending] = useState<SendTarget | null>(null);

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const user = bootstrap.data?.user;
  const firstName = user && !user.isAnonymous ? user.name?.trim().split(/s+/)[0] : null;

  const tryOn = useTryOn('Create an account to wear this yourself');
  const canTryOn = useTryOnAvailable();
  // Said once at the top when try-ons are switched off, in the same place
  // a problem with one would be.
  const [tryOnOff, setTryOnOff] = useState(false);

  const feed = useInfiniteQuery({
    queryKey: ['feed', 'foryou', occasion],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.feed({
        surface: 'foryou',
        cursor: pageParam,
        limit: 10,
        occasion: occasion ?? undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = feed.data?.pages.flatMap((page) => pace(page.items)) ?? [];

  const startTryOn = useCallback(
    (lookId: string) => {
      if (!canTryOn) {
        setTryOnOff(true);
        return;
      }
      setTryOnOff(false);
      setDressing(lookId);
      tryOn.start({ kind: 'RECREATE', lookId });
    },
    [canTryOn, tryOn],
  );

  const sendLook = useCallback((lookId: string) => setSending({ kind: 'LOOK', id: lookId }), []);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case 'pair':
          return (
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 28 }}>
              <FeedTile look={item.first.look} />
              <FeedTile look={item.second.look} />
            </View>
          );

        case 'look':
          return (
            <FeedPost
              look={item.look}
              onPieces={setPiecesFor}
              onTryOn={startTryOn}
              onSend={sendLook}
              dressing={tryOn.busy && dressing === item.look.id}
            />
          );

        case 'shelf':
          return (
            <View
              style={{
                paddingVertical: 18,
                marginBottom: 18,
                gap: 12,
                backgroundColor: colors.sunk,
              }}
            >
              <View
                style={{
                  paddingHorizontal: gutter,
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Heading style={{ fontSize: 18, lineHeight: 24 }}>{item.title}</Heading>
                  {item.subtitle ? <Caption>{item.subtitle}</Caption> : null}
                </View>
                <Pressable
                  onPress={() => router.push('/shop')}
                  accessibilityRole="link"
                  hitSlop={8}
                >
                  <BodyStrong style={{ fontSize: 14, color: colors.primary }}>See all</BodyStrong>
                </Pressable>
              </View>
              <FlatList
                horizontal
                style={{ width: '100%', flexGrow: 0 }}
                data={item.products}
                keyExtractor={(product) => product.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}
                renderItem={({ item: product }) => (
                  <View style={{ width: 150 }}>
                    <ProductCard product={product} />
                  </View>
                )}
              />
            </View>
          );

        case 'prompt':
          return (
            <View style={{ paddingHorizontal: gutter, paddingBottom: 24 }}>
              <View
                style={{
                  backgroundColor: colors.primarySoft,
                  borderRadius: radius.card,
                  padding: 20,
                  gap: 10,
                }}
              >
                <Heading>{item.title}</Heading>
                <Body tone="muted">{item.body}</Body>
                <Button
                  label={item.ctaLabel}
                  full={false}
                  style={{ marginTop: 6 }}
                  onPress={() => {
                    if (item.promptKey === 'questionnaire') router.push('/style');
                    else if (item.promptKey === 'add_photo') router.push('/photos');
                    else router.push('/shop');
                  }}
                />
              </View>
            </View>
          );

        default:
          return (
            <View style={{ paddingHorizontal: gutter, paddingBottom: 24 }}>
              <ProductCard product={item.product} />
            </View>
          );
      }
    },
    [
      colors.primarySoft,
      colors.sunk,
      colors.primary,
      gutter,
      radius.card,
      router,
      startTryOn,
      sendLook,
      tryOn.busy,
      dressing,
    ],
  );

  const header = (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: gutter,
          paddingRight: gutter - 6,
          paddingTop: 2,
          paddingBottom: 8,
          gap: 12,
        }}
      >
        <Heading
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: 'CormorantGaramond_500Medium',
            fontSize: 28,
            lineHeight: 32,
          }}
        >
          {firstName ? `${greeting()}, ${firstName}` : 'Dressed for today'}
        </Heading>
        <InboxButtons />
      </View>
      <OccasionTabs selected={occasion} onSelect={setOccasion} />
      <View style={{ height: 10 }} />

      {/* While Nima works, and if it could not, said once at the top. */}
      {tryOnOff && !tryOn.progress && !tryOn.problem ? (
        <Caption align="center" style={{ marginHorizontal: gutter, marginTop: 8 }}>
          Seeing looks on yourself is switched off in this preview. It is back soon.
        </Caption>
      ) : null}
      {tryOn.progress || tryOn.problem ? (
        <View
          style={{
            marginHorizontal: gutter,
            marginTop: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: radius.chip,
            backgroundColor: tryOn.problem ? colors.accentSoft : colors.primarySoft,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {tryOn.problem ? null : <ActivityIndicator color={colors.primary} />}
          <Body
            style={{ flex: 1, fontSize: 14, lineHeight: 20 }}
            tone={tryOn.problem ? 'critical' : 'primary'}
          >
            {tryOn.problem ?? tryOn.progress}
          </Body>
          {tryOn.problem?.startsWith('Add a photo') ? (
            <Pressable onPress={() => router.push('/photos')} accessibilityRole="link" hitSlop={8}>
              <BodyStrong style={{ fontSize: 14, color: colors.primary }}>Add one</BodyStrong>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const body = (() => {
    if (feed.isLoading) {
      return (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    // A feed that quietly shows nothing when the network failed is the most
    // confusing state there is, so say what happened and offer a retry.
    // Only when there is nothing to show. A failed "load more" keeps the
    // posts already on screen and says so at the bottom instead.
    if (feed.isError && items.length === 0) {
      return (
        <EmptyState
          art="cloud"
          message={
            feed.error instanceof ApiError
              ? feed.error.message
              : 'Nima cannot reach the internet right now.'
          }
          action={<Button label="Try again" full={false} onPress={() => void feed.refetch()} />}
        />
      );
    }

    return null;
  })();

  return (
    <>
      <FlatList
        data={body ? [] : items}
        style={{ width: '100%' }}
        keyExtractor={(item, index) =>
          item.kind === 'pair'
            ? `pair-${item.first.look.id}`
            : item.kind === 'look'
            ? `look-${item.look.id}`
            : item.kind === 'product'
              ? `product-${item.product.id}`
              : `${item.kind}-${index}`
        }
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingBottom: floatingClearance,
          maxWidth: isWide ? 1080 : undefined,
          width: '100%',
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => void feed.refetch()}
            tintColor={colors.primary}
          />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          // After a failure the next page waits for a tap, so a broken
          // request is never retried on every scroll frame.
          if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) {
            void feed.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          body ?? (
            <EmptyState
              art="hanger"
              message={
                occasion
                  ? 'Nothing for this occasion yet. Try another circle, or see everything.'
                  : 'Nothing here yet. Have a look around the shop and Nima will start learning what you like.'
              }
              action={
                occasion ? (
                  <Button label="See everything" full={false} onPress={() => setOccasion(null)} />
                ) : (
                  <Button label="Open the shop" full={false} onPress={() => router.push('/shop')} />
                )
              }
            />
          )
        }
        ListFooterComponent={
          feed.isFetchNextPageError ? (
            <View style={{ paddingVertical: 28, alignItems: 'center', gap: 10 }}>
              <Caption>More looks did not load</Caption>
              <Button label="Try again" full={false} onPress={() => void feed.fetchNextPage()} />
            </View>
          ) : feed.isFetchingNextPage ? (
            <View style={{ paddingVertical: 28 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : items.length > 0 && !body ? (
            <View style={{ paddingVertical: 28, alignItems: 'center', gap: 4 }}>
              <BodyStrong style={{ fontSize: 14 }}>You are all caught up</BodyStrong>
              <Caption>New looks land here every day</Caption>
            </View>
          ) : null
        }
      />

      <PiecesSheet lookId={piecesFor} onClose={() => setPiecesFor(null)} onTryOn={startTryOn} />
      <TryOnResultSheet tryOn={tryOn} label="this look" />
      <SendSheet target={sending} onClose={() => setSending(null)} />
    </>
  );
}
