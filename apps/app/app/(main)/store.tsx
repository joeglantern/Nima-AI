/**
 * My Store: your own profile.
 *
 * The same header a visitor sees on anyone's page (banner, picture, name,
 * numbers, bio, one action and one quiet one), then the tabs: Looks,
 * Lookbooks, Wardrobe, Orders. Each tab gets the line drawing empty state
 * until there is something to show.
 *
 * A guest sees the same header with an invitation instead of a name,
 * because an empty profile that explains itself is better than a wall.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { type EmptyArt, EmptyState } from '../../src/components/empty-state';
import { LookbooksTab } from '../../src/components/lookbooks-tab';
import { Chip, ProfileHeader, UnderlineTabs } from '../../src/components/profile-header';
import { Sheet } from '../../src/components/sheet';
import { Body, BodyStrong, Caption, Eyebrow, Micro, Price } from '../../src/components/text';
import { useTryOnAvailable } from '../../src/components/try-on';
import { WardrobeTab } from '../../src/components/wardrobe-tab';
import { api, type TryOnJob } from '../../src/lib/api';
import { usePageTitle } from '../../src/lib/page-title';
import { SAVED, SELL_HOME } from '../../src/lib/routes';
import { shareProfile } from '../../src/lib/share';
import { useTheme } from '../../src/theme/index';

const TABS = [
  { key: 'looks', label: 'Looks', art: 'hanger' as EmptyArt, empty: 'Your looks will appear here' },
  {
    key: 'lookbooks',
    label: 'Lookbooks',
    art: 'book' as EmptyArt,
    empty: 'Your lookbooks will appear here',
  },
  {
    key: 'wardrobe',
    label: 'Wardrobe',
    art: 'wardrobe' as EmptyArt,
    empty: 'Clothes you already own will appear here',
  },
  {
    key: 'orders',
    label: 'Orders',
    art: 'cart' as EmptyArt,
    empty: 'Your orders will appear here',
  },
] as const;

export default function StoreScreen() {
  usePageTitle('My Store');
  const { colors, gutter, radius, floatingClearance } = useTheme();
  const canTryOn = useTryOnAvailable();
  const { requireAccount } = useAuthGate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('looks');
  const [viewing, setViewing] = useState<TryOnJob | null>(null);

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const user = bootstrap.data?.user;
  const isGuest = !user || user.isAnonymous;

  // Banner and numbers come from the profile; the session carries the rest.
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.myProfile, enabled: !isGuest });

  // Faces of the people you follow, never a count. Nima shows no follower
  // or following totals to anyone, you included.
  const circle = useQuery({
    queryKey: ['circle'],
    queryFn: () => api.circle(),
    enabled: !isGuest,
    staleTime: 60_000,
  });
  const faces = circle.data?.items.slice(0, 4) ?? [];

  const name = isGuest ? 'Your Nima' : user?.name?.trim() || 'You';
  const handle = user?.handle ?? null;

  const tryOns = useQuery({
    queryKey: ['tryons'],
    queryFn: () => api.tryOns({ limit: 12 }),
    enabled: !isGuest,
  });

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders({ limit: 20 }),
    enabled: tab === 'orders' && !isGuest,
  });

  // Keeping a try-on makes it a private look, wearing the pieces it wore.
  const keep = useMutation({
    mutationFn: (id: string) => api.publishTryOn(id, { visibility: 'PRIVATE' }),
    onSuccess: (result) => {
      setViewing((current) => (current ? { ...current, lookId: result.lookId } : current));
      void queryClient.invalidateQueries({ queryKey: ['tryons'] });
    },
  });

  const active = TABS.find((entry) => entry.key === tab) ?? TABS[0];
  const jobs = tryOns.data?.items ?? [];

  function openLook(lookId: string) {
    setViewing(null);
    router.push({ pathname: '/look/[id]', params: { id: lookId } });
  }

  return (
    <>
      <ScrollView
        style={{ width: '100%' }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: floatingClearance, width: '100%' }}
      >
        <ProfileHeader
          banner={profile.data?.banner?.url ?? null}
          avatar={user?.avatarUrl ?? null}
          name={name}
          handle={handle}
          line={
            isGuest
              ? 'Sign in to keep your looks, wardrobe and orders, or to open a shop of your own'
              : (user?.email ?? null)
          }
          bio={profile.data?.bio ?? null}
          stats={profile.data?.stats ?? { looks: 0, loved: 0 }}
          onStat={() => setTab('looks')}
          faces={
            faces.length
              ? {
                  people: faces.map((person) => ({
                    key: person.id,
                    url: person.avatar?.url,
                    name: person.displayName,
                  })),
                  label: 'Your circle',
                  onPress: () => router.push('/circle'),
                }
              : null
          }
          primary={
            isGuest
              ? {
                  label: 'Create an account',
                  onPress: () => requireAccount('Create an account to keep everything you make'),
                }
              : { label: 'Edit profile', onPress: () => router.push('/profile') }
          }
          secondary={
            !isGuest && handle
              ? { label: 'Share', onPress: () => void shareProfile(handle, name) }
              : undefined
          }
          onSettings={() => router.push('/settings')}
        >
          {!isGuest && canTryOn ? (
            <TryOnPill
              credits={bootstrap.data?.credits.balance ?? 0}
              tryOnCost={bootstrap.data?.costs.tryOnSingleItem ?? 1}
            />
          ) : null}
          {!isGuest ? <Chip label="Hung up" onPress={() => router.push(SAVED)} /> : null}
        </ProfileHeader>

        <View style={{ paddingHorizontal: gutter, paddingTop: 16, gap: 12 }}>
          {!isGuest ? <ShopCard /> : null}

          {!isGuest && (user?.styleProfileCompletion ?? 0) < 100 ? (
            <Pressable
              onPress={() => router.push('/style')}
              accessibilityRole="button"
              style={({ pressed }) => ({
                backgroundColor: colors.primarySoft,
                borderRadius: radius.card,
                padding: 18,
                gap: 8,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Eyebrow>{`Style profile ${user?.styleProfileCompletion ?? 0} percent`}</Eyebrow>
              <Body>Answer a few more and Nima gets sharper at picking for you.</Body>
            </Pressable>
          ) : null}

          <UnderlineTabs tabs={TABS} selected={tab} onSelect={setTab} />
        </View>

        {isGuest ? (
          <EmptyState art={active.art} message={active.empty} />
        ) : tab === 'wardrobe' ? (
          <WardrobeTab />
        ) : tab === 'lookbooks' ? (
          <LookbooksTab />
        ) : tab === 'orders' && (orders.data?.items.length ?? 0) > 0 ? (
          <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 12 }}>
            {orders.data?.items.map((placed) => (
              <Pressable
                key={placed.id}
                onPress={() => router.push({ pathname: '/order/[id]', params: { id: placed.id } })}
                accessibilityRole="button"
                style={{
                  padding: 16,
                  gap: 8,
                  borderRadius: radius.card,
                  backgroundColor: colors.surface,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <BodyStrong>{placed.store.name}</BodyStrong>
                  <OrderBadge status={placed.status} />
                </View>

                <Micro>{`${placed.reference} · ${new Date(placed.placedAt).toLocaleDateString('en-KE')}`}</Micro>

                <Body numberOfLines={2} tone="muted">
                  {placed.items.map((entry) => entry.title).join(', ')}
                </Body>

                <Price cents={placed.totalCents} style={{ fontSize: 16 }} />
              </Pressable>
            ))}
          </View>
        ) : tab === 'looks' && jobs.length > 0 ? (
          <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 12 }}>
            {jobs.map((job) => {
              const ready = job.status === 'DONE' && job.image !== null;

              return (
                <Pressable
                  key={job.id}
                  disabled={!ready}
                  onPress={() => setViewing(job)}
                  accessibilityRole="button"
                  accessibilityLabel={ready ? 'See this look' : undefined}
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
                    }}
                  >
                    {job.image ? (
                      <Image
                        source={{ uri: job.image.url }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                      />
                    ) : null}
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <Body>
                      {job.status === 'DONE'
                        ? 'Ready'
                        : job.status === 'FAILED'
                          ? 'Did not work, nothing was used'
                          : 'Nima is dressing you'}
                    </Body>
                    <Caption>{new Date(job.createdAt).toLocaleDateString('en-KE')}</Caption>
                  </View>

                  {job.lookId ? (
                    <Micro tone="primary">In your looks</Micro>
                  ) : ready ? (
                    <Chevron color={colors.muted} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <EmptyState art={active.art} message={active.empty} />
        )}
      </ScrollView>

      {/* A finished try-on, full size */}
      <Sheet open={viewing !== null} onClose={() => setViewing(null)} title="Here you are">
        {viewing?.image ? (
          <Image
            source={{ uri: viewing.image.url }}
            style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.image }}
            contentFit="cover"
            accessibilityLabel="You, in this look"
          />
        ) : null}

        <View
          style={{
            backgroundColor: colors.secondarySoft,
            borderRadius: radius.image,
            padding: 14,
            gap: 4,
            marginTop: 8,
          }}
        >
          <Eyebrow tone="secondary">{bootstrap.data?.fitNotice.title ?? 'About the fit'}</Eyebrow>
          <Caption tone="ink">
            {bootstrap.data?.fitNotice.body ??
              "Nima shows you how something looks, not how it will fit. Check the seller's size guide."}
          </Caption>
        </View>

        {viewing?.lookId ? (
          <Button
            label="Open the look"
            onPress={() => {
              if (viewing.lookId) openLook(viewing.lookId);
            }}
          />
        ) : (
          <Button
            label="Save to my looks"
            loading={keep.isPending}
            onPress={() => {
              if (viewing) keep.mutate(viewing.id);
            }}
          />
        )}
        {keep.isError ? (
          <Body tone="critical" align="center">
            That did not save. Try again in a moment.
          </Body>
        ) : null}
        <Button label="Close" variant="quiet" onPress={() => setViewing(null)} />
      </Sheet>
    </>
  );
}

/**
 * Where an order has got to.
 *
 * Plain words rather than the enum. Nobody outside this codebase knows what
 * READY_FOR_PICKUP means, and "ready to collect" is the same length.
 */
function OrderBadge({ status }: { status: string }) {
  const { colors, radius } = useTheme();

  const words: Record<string, string> = {
    PENDING_PAYMENT: 'Waiting to be paid',
    PAID: 'Paid',
    PREPARING: 'Being packed',
    READY_FOR_PICKUP: 'Ready to collect',
    IN_TRANSIT: 'On its way',
    DELIVERED: 'Delivered',
    COMPLETED: 'Done',
    CANCELLED: 'Cancelled',
    REFUNDED: 'Refunded',
  };

  const quiet = status === 'CANCELLED' || status === 'REFUNDED';

  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: quiet ? colors.sunk : colors.accentSoft,
      }}
    >
      <Micro tone={quiet ? 'muted' : 'ink'}>{words[status] ?? status}</Micro>
    </View>
  );
}

/**
 * How many try-ons the balance buys.
 *
 * Said as try-ons, not credits: a try-on is the thing a person actually gets,
 * and nothing in the app is sold for money, so there is no currency to name.
 * Green, as the screens draw it. A balance is a quantity you hold, not brand
 * furniture, so it takes the semantic positive colour rather than the
 * burgundy, and stays legible next to a name set in the brand serif.
 */
function TryOnPill({ credits, tryOnCost }: { credits: number; tryOnCost: number }) {
  const { colors, radius } = useTheme();
  const left = Math.floor(credits / Math.max(1, tryOnCost));

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: radius.pill,
        backgroundColor: colors.positiveSoft,
        borderWidth: 1,
        borderColor: colors.positive,
      }}
    >
      <Svg width={13} height={13} viewBox="0 0 24 24">
        <Path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill={colors.positive} />
      </Svg>
      <BodyStrong style={{ fontSize: 14, color: colors.positive }}>
        {`${left.toLocaleString('en-KE')} ${left === 1 ? 'try-on' : 'try-ons'} left`}
      </BodyStrong>
    </View>
  );
}

function Chevron({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="m10 6 6 6-6 6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/**
 * Selling, from your own profile.
 *
 * One account buys and sells. Without a shop this is a quiet invitation;
 * with one it is the way to the counter, and says when orders are waiting.
 */
function ShopCard() {
  const { colors, radius } = useTheme();
  const router = useRouter();
  const shop = useQuery({
    queryKey: ['seller-store'],
    queryFn: api.sellerStore,
    staleTime: 30_000,
  });

  if (shop.isLoading) return null;
  const store = shop.data?.store;
  const waiting = store?.stats.openOrders ?? 0;

  return (
    <Pressable
      onPress={() => router.push(store ? SELL_HOME : '/sell/setup')}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        borderRadius: radius.card,
        backgroundColor: pressed ? colors.sunk : colors.surface,
        borderWidth: waiting ? 1 : 0,
        borderColor: colors.accent,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accentSoft,
        }}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path
            d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8M10 20v-4.5h4V20"
            stroke={colors.primary}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <BodyStrong>{store ? store.name : 'Sell on Nima'}</BodyStrong>
        <Caption numberOfLines={2}>
          {store
            ? waiting
              ? `${waiting} ${waiting === 1 ? 'order' : 'orders'} waiting to be packed`
              : `${store.stats.activeProducts} ${store.stats.activeProducts === 1 ? 'piece' : 'pieces'} in the shop`
            : 'Open a shop and let people try your pieces on before they buy'}
        </Caption>
      </View>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d="m9 6 6 6-6 6"
          stroke={colors.muted}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </Pressable>
  );
}
