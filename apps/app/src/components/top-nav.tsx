/**
 * The pill navigation from the screens: Shop, For You, My Store.
 *
 * On a phone it sits at the top, centred, with the active item in a filled
 * pill. On a wide window the same three destinations become a left sidebar,
 * because a row of three pills across 1400 pixels looks lost.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, usePathname, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../lib/api';
import { useTheme } from '../theme/index';
import { Body, BodyStrong, Display, Label, Micro } from './text';

export interface Destination {
  label: string;
  href: '/shop' | '/' | '/store';
}

export const DESTINATIONS: Destination[] = [
  { label: 'Shop', href: '/shop' },
  { label: 'For You', href: '/' },
  { label: 'My Store', href: '/store' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

export function TopPills() {
  const { colors, radius } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <View style={{ justifyContent: 'center' }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 10,
        }}
        accessibilityRole="tablist"
      >
        {DESTINATIONS.map((destination) => {
          const active = isActive(pathname, destination.href);

          return (
            <Pressable
              key={destination.href}
              onPress={() => router.navigate(destination.href)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: 22,
                paddingVertical: 9,
                borderRadius: radius.pill,
                backgroundColor: active ? colors.accent : 'transparent',
              }}
            >
              {active ? (
                <BodyStrong style={{ color: colors.onAccent }}>{destination.label}</BodyStrong>
              ) : (
                // Inactive labels sit in the burgundy at normal weight, so the
                // filled pill is the only thing shouting.
                <Body style={{ color: colors.primary }}>{destination.label}</Body>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Pinned to the right so the pills stay centred, as in the screens. */}
      <View style={{ position: 'absolute', right: 12 }} pointerEvents="box-none">
        <BasketButton />
      </View>
    </View>
  );
}

/**
 * The way to the basket.
 *
 * Absent until payments are connected and until there is something in it.
 * An empty bag icon on every screen is a permanent reminder of a thing you
 * have not done, and the screens do not have one.
 */
export function BasketButton() {
  const { colors } = useTheme();
  const router = useRouter();

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const signedIn = Boolean(bootstrap.data?.user && !bootstrap.data.user.isAnonymous);

  const count = useQuery({
    queryKey: ['cart-count'],
    queryFn: api.cartCount,
    enabled: signedIn && Boolean(bootstrap.data?.features.checkout),
    staleTime: 15_000,
  });

  const items = count.data?.count ?? 0;
  if (!bootstrap.data?.features.checkout || items === 0) return null;

  return (
    <Pressable
      onPress={() => router.push('/cart')}
      accessibilityRole="button"
      accessibilityLabel={`Basket, ${items} ${items === 1 ? 'piece' : 'pieces'}`}
      style={{ padding: 6 }}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path
          d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Zm3 0V6a3 3 0 0 1 6 0v2"
          stroke={colors.primary}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>

      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          minWidth: 17,
          height: 17,
          paddingHorizontal: 4,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accent,
        }}
      >
        <Micro style={{ color: colors.onAccent, fontSize: 10, lineHeight: 13 }}>
          {items > 9 ? '9+' : String(items)}
        </Micro>
      </View>
    </Pressable>
  );
}

/** The wide layout's left rail. */
export function Sidebar() {
  const { colors, radius } = useTheme();
  const pathname = usePathname();

  return (
    <View
      style={{
        width: 240,
        paddingHorizontal: 20,
        paddingVertical: 28,
        gap: 28,
        borderRightWidth: 1,
        borderRightColor: colors.line,
        backgroundColor: colors.ground,
      }}
    >
      <View>
        <Display style={{ fontSize: 34, lineHeight: 38 }}>Nima</Display>
        <Label style={{ marginTop: 4 }}>AI stylist</Label>
      </View>

      <View style={{ gap: 4 }} accessibilityRole="tablist">
        {DESTINATIONS.map((destination) => {
          const active = isActive(pathname, destination.href);

          return (
            <Link key={destination.href} href={destination.href} asChild>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  borderRadius: radius.pill,
                  backgroundColor: active ? colors.accent : 'transparent',
                }}
              >
                <BodyStrong style={{ color: active ? colors.onAccent : colors.ink }}>
                  {destination.label}
                </BodyStrong>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </View>
  );
}
