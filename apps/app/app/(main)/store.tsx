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

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useTheme } from '../../src/theme/index';
import { Body, BodyStrong, Caption, Label, Title } from '../../src/components/text';
import { Button } from '../../src/components/button';
import { EmptyState, type EmptyArt } from '../../src/components/empty-state';
import { useAuthGate } from '../../src/components/auth-gate';

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
  { key: 'orders', label: 'Orders', art: 'cart' as EmptyArt, empty: 'Your orders will appear here' },
] as const;

export default function StoreScreen() {
  const { colors, gutter, radius } = useTheme();
  const { requireAccount } = useAuthGate();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('looks');

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const tryOns = useQuery({
    queryKey: ['tryons'],
    queryFn: () => api.tryOns({ limit: 12 }),
    enabled: Boolean(bootstrap.data?.user && !bootstrap.data.user.isAnonymous),
  });

  const user = bootstrap.data?.user;
  const isGuest = !user || user.isAnonymous;
  const active = TABS.find((entry) => entry.key === tab) ?? TABS[0];

  return (
    <ScrollView
      style={{ width: '100%' }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 56, width: '100%' }}
    >
      <View style={{ paddingHorizontal: gutter, paddingTop: 8, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View
            style={{
              width: 84,
              height: 84,
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
            ) : null}
          </View>

          <View style={{ flex: 1, gap: 6 }}>
            <Title numberOfLines={1}>{isGuest ? 'Your Nima' : (user?.name ?? 'You')}</Title>

            {isGuest ? (
              <Caption>Sign in to keep your looks, wardrobe and orders</Caption>
            ) : (
              <>
                <Caption numberOfLines={1}>{user?.email ?? ''}</Caption>
                <View
                  style={{
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                    backgroundColor: colors.secondarySoft,
                  }}
                >
                  <Label tone="secondary" style={{ letterSpacing: 1 }}>
                    {`${bootstrap.data?.credits.balance ?? 0} credits`}
                  </Label>
                </View>
              </>
            )}
          </View>
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
            <Label tone="primary">
              {`Style profile ${user?.styleProfileCompletion ?? 0} percent`}
            </Label>
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
          padding: 4,
          borderRadius: radius.pill,
          backgroundColor: colors.sunk,
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
                style={{ fontSize: 14, color: selected ? colors.onPrimary : colors.ink }}
                numberOfLines={1}
              >
                {entry.label}
              </BodyStrong>
            </Pressable>
          );
        })}
      </View>

      {tab === 'looks' && (tryOns.data?.items.length ?? 0) > 0 ? (
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
