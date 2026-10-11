/**
 * My Store: the profile screen from the design.
 *
 * A card with the person on it, then the tabs: Looks, Lookbooks, Wardrobe,
 * Orders. Each tab gets the line drawing empty state until there is
 * something to show.
 *
 * A visitor sees the same card with an invitation instead of their name,
 * because an empty profile that explains itself is better than a wall.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { type EmptyArt, EmptyState } from '../../src/components/empty-state';
import { LookbooksTab } from '../../src/components/lookbooks-tab';
import { Sheet } from '../../src/components/sheet';
import { Body, BodyStrong, Caption, Eyebrow, Micro, Price, Title } from '../../src/components/text';
import { WardrobeTab } from '../../src/components/wardrobe-tab';
import { api, type SessionUser, type TryOnJob } from '../../src/lib/api';
import { elevation } from '../../src/theme/elevation';
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
  const { colors, gutter, radius, width, floatingClearance } = useTheme();
  const { requireAccount } = useAuthGate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('looks');
  const [viewing, setViewing] = useState<TryOnJob | null>(null);

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const user = bootstrap.data?.user;
  const isGuest = !user || user.isAnonymous;

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
        <View style={{ paddingHorizontal: gutter, paddingTop: 8, gap: 16 }}>
          <ProfileCard
            user={isGuest ? null : (user ?? null)}
            credits={bootstrap.data?.credits.balance ?? 0}
            onSettings={() => router.push('/settings')}
            onEdit={() => router.push('/profile')}
            onSignIn={() => requireAccount('Create an account to keep everything you make')}
          />

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
        </View>

        {/* Tabs */}
        <View
          style={{
            flexDirection: 'row',
            gap: 6,
            marginTop: 20,
            marginHorizontal: gutter,
            padding: 5,
            borderRadius: radius.pill,
            // White, so the row reads as a control sitting on the page rather
            // than a dent in it.
            backgroundColor: colors.surface,
            ...elevation('raised'),
          }}
          accessibilityRole="tablist"
        >
          {TABS.map((entry) => {
            const selected = entry.key === tab;

            return (
              <Pressable
                key={entry.key}
                onPress={() => setTab(entry.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  backgroundColor: selected ? colors.primary : 'transparent',
                }}
              >
                <BodyStrong
                  style={{
                    fontSize: width < 400 ? 12.5 : 14,
                    color: selected ? colors.onPrimary : colors.ink,
                  }}
                  numberOfLines={1}
                >
                  {entry.label}
                </BodyStrong>
              </Pressable>
            );
          })}
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
                          ? 'Did not work, credits returned'
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
 * The person at the top of the page.
 *
 * A deep band with the picture hanging off its lower edge, the way a
 * profile reads on paper: the picture first, then the name under it, then
 * what they hold. The settings gear sits in the band's corner where a
 * label cannot wrap, which is what the old one did on a narrow phone.
 */
function ProfileCard({
  user,
  credits,
  onSettings,
  onEdit,
  onSignIn,
}: {
  /** Null for a guest. */
  user: SessionUser | null;
  credits: number;
  onSettings: () => void;
  onEdit: () => void;
  onSignIn: () => void;
}) {
  const { colors, radius, width } = useTheme();
  const size = width < 400 ? 84 : 96;
  const name = user ? (user.name ?? 'You') : 'Your Nima';
  const initial = name.trim().charAt(0).toUpperCase() || 'N';

  return (
    <View
      style={{
        borderRadius: radius.card,
        backgroundColor: colors.surface,
        overflow: 'hidden',
        ...elevation('raised'),
      }}
    >
      {/* The band, with the warm note from the opening screen in it */}
      <View style={{ height: 88, backgroundColor: colors.espresso, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            right: -36,
            top: -64,
            width: 172,
            height: 172,
            borderRadius: 999,
            backgroundColor: colors.accent,
            opacity: 0.28,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: -24,
            bottom: -84,
            width: 132,
            height: 132,
            borderRadius: 999,
            backgroundColor: colors.onEspresso,
            opacity: 0.08,
          }}
        />

        <Pressable
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
          style={({ pressed }) => ({
            position: 'absolute',
            top: 12,
            right: 12,
            width: 36,
            height: 36,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accent,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <GearMark color={colors.onAccent} hole={colors.accent} />
        </Pressable>
      </View>

      {/* The person, hanging off the band */}
      <View
        style={{
          alignItems: 'center',
          marginTop: -(size / 2),
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        <View
          style={{
            width: size + 8,
            height: size + 8,
            borderRadius: 999,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: size,
              height: size,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {user?.avatarUrl ? (
              <Image
                source={{ uri: user.avatarUrl }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                accessibilityLabel="Your photo"
              />
            ) : (
              // An empty circle reads as a picture that failed to load. An
              // initial reads as a person who has not added one yet.
              <Title style={{ fontSize: 38, lineHeight: 44, color: colors.primary }}>
                {initial}
              </Title>
            )}
          </View>
        </View>

        <Title numberOfLines={1} align="center" style={{ marginTop: 8 }}>
          {name}
        </Title>

        {user ? (
          <Caption numberOfLines={1} align="center">
            {user.handle ? `@${user.handle}` : (user.email ?? '')}
          </Caption>
        ) : (
          <Caption align="center">Sign in to keep your looks, wardrobe and orders</Caption>
        )}

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            marginTop: 14,
          }}
        >
          {user ? (
            <>
              <CreditPill credits={credits} />
              <Pressable
                onPress={onEdit}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: pressed ? colors.sunk : 'transparent',
                })}
              >
                <BodyStrong style={{ fontSize: 14, color: colors.ink }}>Edit profile</BodyStrong>
              </Pressable>
            </>
          ) : (
            <Button label="Create an account" full={false} onPress={onSignIn} />
          )}
        </View>
      </View>
    </View>
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
 * The credit balance.
 *
 * Green, as the screens draw it. A balance is a quantity you hold, not brand
 * furniture, so it takes the semantic positive colour rather than the
 * burgundy, and stays legible next to a name set in the brand serif.
 */
function CreditPill({ credits }: { credits: number }) {
  const { colors, radius } = useTheme();

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
        {`${credits.toLocaleString('en-KE')} credits`}
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

function GearMark({ color, hole }: { color: string; hole: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M10.4 2h3.2l.4 2.2c.6.2 1.1.5 1.6.8l2-1.1 2.3 2.3-1.1 2c.3.5.6 1 .8 1.6l2.2.4v3.2l-2.2.4c-.2.6-.5 1.1-.8 1.6l1.1 2-2.3 2.3-2-1.1c-.5.3-1 .6-1.6.8L13.6 22h-3.2l-.4-2.2a7 7 0 0 1-1.6-.8l-2 1.1-2.3-2.3 1.1-2c-.3-.5-.6-1-.8-1.6L2.2 13.6v-3.2l2.2-.4c.2-.6.5-1.1.8-1.6l-1.1-2 2.3-2.3 2 1.1c.5-.3 1-.6 1.6-.8L10.4 2Z"
      />
      <Circle cx={12} cy={12} r={3.2} fill={hole} />
    </Svg>
  );
}
