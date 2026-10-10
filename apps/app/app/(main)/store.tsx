/**
 * My Store: the profile screen from the design.
 *
 * Header, credit pill, style tags, highlight circles, then the tabs:
 * Looks, Lookbooks, Wardrobe, Orders. Each tab gets the line drawing empty
 * state until there is something to show.
 *
 * A visitor sees the same frame with an invitation instead of their name,
 * because an empty profile that explains itself is better than a wall.
 */

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { type EmptyArt, EmptyState } from '../../src/components/empty-state';
import { LookbooksTab } from '../../src/components/lookbooks-tab';
import { Body, BodyStrong, Caption, Eyebrow, Micro, Price, Title } from '../../src/components/text';
import { WardrobeTab } from '../../src/components/wardrobe-tab';
import { api } from '../../src/lib/api';
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
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('looks');

  const router = useRouter();
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const tryOns = useQuery({
    queryKey: ['tryons'],
    queryFn: () => api.tryOns({ limit: 12 }),
    enabled: Boolean(bootstrap.data?.user && !bootstrap.data.user.isAnonymous),
  });

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders({ limit: 20 }),
    enabled: tab === 'orders' && Boolean(bootstrap.data?.user && !bootstrap.data.user.isAnonymous),
  });

  const user = bootstrap.data?.user;
  const isGuest = !user || user.isAnonymous;
  const active = TABS.find((entry) => entry.key === tab) ?? TABS[0];

  return (
    <ScrollView
      style={{ width: '100%' }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: floatingClearance, width: '100%' }}
    >
      <View style={{ paddingHorizontal: gutter, paddingTop: 8, gap: 18 }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: width < 400 ? 10 : 14 }}
        >
          <View
            style={{
              width: width < 400 ? 72 : 88,
              height: width < 400 ? 72 : 88,
              borderRadius: 999,
              backgroundColor: colors.sunk,
              overflow: 'hidden',
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
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Title style={{ fontSize: 34, lineHeight: 40, color: colors.muted }}>
                  {(isGuest ? 'N' : (user?.name ?? 'Y')).trim().charAt(0).toUpperCase()}
                </Title>
              </View>
            )}
          </View>

          {/* The screens centre the name over the email and the credit pill. */}
          <View style={{ flex: 1, alignItems: 'center', gap: 4, paddingTop: 4 }}>
            <Title numberOfLines={1} align="center">
              {isGuest ? 'Your Nima' : (user?.name ?? 'You')}
            </Title>

            {isGuest ? (
              <Caption align="center">Sign in to keep your looks, wardrobe and orders</Caption>
            ) : (
              <>
                <Caption numberOfLines={1}>{user?.email ?? ''}</Caption>
                <CreditPill credits={bootstrap.data?.credits.balance ?? 0} />
              </>
            )}
          </View>

          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={{ alignItems: 'center', gap: 4, paddingTop: 4, width: 48 }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.espresso,
              }}
            >
              <GearMark color={colors.onEspresso} hole={colors.espresso} />
            </View>
            <Micro tone="ink">Settings</Micro>
          </Pressable>
        </View>

        {isGuest ? (
          <Button
            label="Create an account"
            onPress={() => requireAccount('Create an account to keep everything you make')}
          />
        ) : null}

        {!isGuest && (user?.styleProfileCompletion ?? 0) < 100 ? (
          <View
            style={{
              backgroundColor: colors.primarySoft,
              borderRadius: radius.card,
              padding: 18,
              gap: 8,
            }}
          >
            <Eyebrow>{`Style profile ${user?.styleProfileCompletion ?? 0} percent`}</Eyebrow>
            <Body>Answer a few more and Nima gets sharper at picking for you.</Body>
          </View>
        ) : null}
      </View>

      {/* Tabs */}
      <View
        style={{
          flexDirection: 'row',
          gap: 6,
          marginTop: 24,
          marginHorizontal: gutter,
          padding: 5,
          borderRadius: radius.pill,
          // White, so the row reads as a control sitting on the page rather
          // than a dent in it. This is the one place the screens use a shadow.
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
      ) : tab === 'looks' && (tryOns.data?.items.length ?? 0) > 0 ? (
        <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 12 }}>
          {tryOns.data?.items.map((job) => (
            <View
              key={job.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: 12,
                borderRadius: radius.card,
                backgroundColor: colors.surface,
              }}
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
            </View>
          ))}
        </View>
      ) : (
        <EmptyState art={active.art} message={active.empty} />
      )}
    </ScrollView>
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
        paddingVertical: 6,
        marginTop: 2,
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
