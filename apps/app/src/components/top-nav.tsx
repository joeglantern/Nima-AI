/**
 * The pill navigation from the screens: Shop, For You, My Store.
 *
 * On a phone it sits at the top, centred, with the active item in a filled
 * pill. On a wide window the same three destinations become a left sidebar,
 * because a row of three pills across 1400 pixels looks lost.
 */

import { Pressable, View } from 'react-native';
import { Link, usePathname, useRouter } from 'expo-router';
import { useTheme } from '../theme/index';
import { BodyStrong, Display, Label } from './text';

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
              paddingHorizontal: 20,
              paddingVertical: 9,
              borderRadius: radius.pill,
              backgroundColor: active ? colors.primary : 'transparent',
            }}
          >
            <BodyStrong style={{ color: active ? colors.onPrimary : colors.primary }}>
              {destination.label}
            </BodyStrong>
          </Pressable>
        );
      })}
    </View>
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
                  backgroundColor: active ? colors.primary : 'transparent',
                }}
              >
                <BodyStrong style={{ color: active ? colors.onPrimary : colors.ink }}>
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
