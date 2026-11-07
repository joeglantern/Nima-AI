/**
 * The top of a profile, yours or anyone's.
 *
 * Laid out the way the big social apps lay out a person: a banner across the
 * top, the picture hanging off its lower edge, the name and handle under it,
 * one row of numbers, the bio, one primary action and one quiet one, then
 * the tabs. Both My Store and a public profile draw from this file, so the
 * two never drift.
 *
 * What the numbers are not: followers. Nima counts looks and the loves they
 * drew, never people, so the third cell shows faces, not a total.
 */

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { sized } from '../lib/media';
import { useTheme } from '../theme/index';
import { Button } from './button';
import { Avatar } from './feed-post';
import { Body, BodyStrong, Caption, Micro, Title } from './text';

export interface HeaderFace {
  key: string;
  url?: string | null;
  name: string;
}

export interface HeaderAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'quiet';
  loading?: boolean;
}

export interface ProfileHeaderProps {
  banner: string | null;
  avatar: string | null;
  name: string;
  handle: string | null;
  /** A line under the handle when there is no bio to show. */
  line?: string | null;
  bio?: string | null;
  link?: string | null;
  onLink?: () => void;
  stats: { looks: number; loved: number };
  onStat?: (key: 'looks' | 'loved') => void;
  /** The third cell: a few faces and what they are. */
  faces?: { people: HeaderFace[]; label: string; onPress?: () => void } | null;
  primary: HeaderAction;
  secondary?: HeaderAction;
  /** Round controls over the banner's corners. */
  onBack?: () => void;
  onSettings?: () => void;
  onMore?: () => void;
  /** Chips under the actions: a shop, a notice. */
  children?: ReactNode;
}

const BANNER_RATIO = 16 / 7;

export function ProfileHeader({
  banner,
  avatar,
  name,
  handle,
  line,
  bio,
  link,
  onLink,
  stats,
  onStat,
  faces,
  primary,
  secondary,
  onBack,
  onSettings,
  onMore,
  children,
}: ProfileHeaderProps) {
  const { colors, gutter, width, isCompact } = useTheme();
  const size = isCompact ? 92 : 104;
  const initial = name.trim().charAt(0).toUpperCase() || 'N';
  const bannerHeight = Math.min(220, Math.round(Math.min(width, 980) / BANNER_RATIO));

  return (
    <View style={{ width: '100%' }}>
      {/* The banner, edge to edge */}
      <View
        style={{
          height: bannerHeight,
          backgroundColor: colors.espresso,
          overflow: 'hidden',
        }}
      >
        {banner ? (
          <Image
            source={{ uri: sized(banner, 1080) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={160}
            accessibilityLabel={`${name}'s banner`}
          />
        ) : (
          // The house placeholder: the warm note from the opening screen,
          // not a stock gradient and not a grey box.
          <>
            <View
              style={{
                position: 'absolute',
                right: -40,
                top: -90,
                width: 240,
                height: 240,
                borderRadius: 999,
                backgroundColor: colors.accent,
                opacity: 0.26,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: -30,
                bottom: -120,
                width: 190,
                height: 190,
                borderRadius: 999,
                backgroundColor: colors.onEspresso,
                opacity: 0.07,
              }}
            />
          </>
        )}

        {onBack ? (
          <Overlay onPress={onBack} label="Back" side="left">
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path
                d="m14 6-6 6 6 6"
                stroke="#FFFFFF"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Overlay>
        ) : null}
        {onSettings ? (
          <Overlay onPress={onSettings} label="Settings" side="right">
            <GearMark />
          </Overlay>
        ) : null}
        {onMore ? (
          <Overlay onPress={onMore} label="More" side="right">
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Circle cx={6} cy={12} r={1.8} fill="#FFFFFF" />
              <Circle cx={12} cy={12} r={1.8} fill="#FFFFFF" />
              <Circle cx={18} cy={12} r={1.8} fill="#FFFFFF" />
            </Svg>
          </Overlay>
        ) : null}
      </View>

      {/* The person, hanging off the banner */}
      <View style={{ alignItems: 'center', marginTop: -(size / 2), paddingHorizontal: gutter }}>
        <View
          style={{
            width: size + 8,
            height: size + 8,
            borderRadius: 999,
            backgroundColor: colors.ground,
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
            {avatar ? (
              <Image
                source={{ uri: sized(avatar, 240) }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                accessibilityLabel={`${name}'s picture`}
              />
            ) : (
              // An initial reads as a person who has not added a picture;
              // an empty circle reads as one that failed to load.
              <Title style={{ fontSize: 38, lineHeight: 44, color: colors.primary }}>
                {initial}
              </Title>
            )}
          </View>
        </View>

        <Title numberOfLines={1} align="center" style={{ marginTop: 8 }}>
          {name}
        </Title>
        {handle ? (
          <Caption numberOfLines={1} align="center">
            {`@${handle}`}
          </Caption>
        ) : line ? (
          <Caption align="center" style={{ maxWidth: 360 }}>
            {line}
          </Caption>
        ) : null}

        {/* The numbers, and the faces */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'center',
            marginTop: 14,
            gap: 4,
          }}
        >
          <Stat
            value={stats.looks}
            label={stats.looks === 1 ? 'look' : 'looks'}
            onPress={onStat ? () => onStat('looks') : undefined}
          />
          <Rule />
          <Stat
            value={stats.loved}
            label="loved"
            onPress={onStat ? () => onStat('loved') : undefined}
          />
          {faces && faces.people.length > 0 ? (
            <>
              <Rule />
              <Pressable
                onPress={faces.onPress}
                disabled={!faces.onPress}
                accessibilityRole={faces.onPress ? 'button' : undefined}
                accessibilityLabel={faces.label}
                style={({ pressed }) => ({
                  minWidth: 88,
                  minHeight: 44,
                  paddingHorizontal: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flexDirection: 'row', height: 24, alignItems: 'center' }}>
                  {faces.people.slice(0, 4).map((person, index) => (
                    <View
                      key={person.key}
                      style={{
                        marginLeft: index === 0 ? 0 : -8,
                        borderRadius: 999,
                        borderWidth: 2,
                        borderColor: colors.ground,
                      }}
                    >
                      <Avatar url={person.url} name={person.name} size={24} />
                    </View>
                  ))}
                </View>
                <Micro numberOfLines={1}>{faces.label}</Micro>
              </Pressable>
            </>
          ) : null}
        </View>

        {bio ? (
          <Body align="center" style={{ marginTop: 10, maxWidth: 420 }}>
            {bio}
          </Body>
        ) : null}
        {link ? (
          <Pressable onPress={onLink} accessibilityRole="link" hitSlop={6} style={{ marginTop: 4 }}>
            <Caption tone="primary" align="center">
              {link.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </Caption>
          </Pressable>
        ) : null}

        {/* One main action, one quiet one */}
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginTop: 14,
            width: '100%',
            maxWidth: 420,
          }}
        >
          <View style={{ flex: secondary ? 1.4 : 1 }}>
            <Button
              label={primary.label}
              variant={primary.variant ?? 'primary'}
              loading={primary.loading}
              onPress={primary.onPress}
              style={{ paddingVertical: 13 }}
            />
          </View>
          {secondary ? (
            <View style={{ flex: 1 }}>
              <Button
                label={secondary.label}
                variant={secondary.variant ?? 'quiet'}
                loading={secondary.loading}
                onPress={secondary.onPress}
                style={{ paddingVertical: 13 }}
              />
            </View>
          ) : null}
        </View>

        {children ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 8,
              marginTop: 12,
              width: '100%',
            }}
          >
            {children}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => ({
        minWidth: 72,
        minHeight: 44,
        paddingHorizontal: 10,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <BodyStrong
        style={{ fontSize: 17, lineHeight: 22, color: colors.ink, fontVariant: ['tabular-nums'] }}
      >
        {compact(value)}
      </BodyStrong>
      <Micro>{label}</Micro>
    </Pressable>
  );
}

function Rule() {
  const { colors } = useTheme();
  return <View style={{ width: 1, height: 22, marginTop: 11, backgroundColor: colors.line }} />;
}

/** 1200 stays 1,200; 12,400 becomes 12.4K, as the social apps do. */
function compact(value: number): string {
  if (value < 10_000) return value.toLocaleString('en-KE');
  if (value < 1_000_000)
    return `${(value / 1000).toFixed(value < 100_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** A round control sitting on the banner, readable over any photograph. */
function Overlay({
  onPress,
  label,
  side,
  children,
}: {
  onPress: () => void;
  label: string;
  side: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({
        position: 'absolute',
        top: 12,
        [side]: 12,
        width: 40,
        height: 40,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.38)',
      })}
    >
      {children}
    </Pressable>
  );
}

function GearMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill="#FFFFFF"
        d="M10.4 2h3.2l.4 2.2c.6.2 1.1.5 1.6.8l2-1.1 2.3 2.3-1.1 2c.3.5.6 1 .8 1.6l2.2.4v3.2l-2.2.4c-.2.6-.5 1.1-.8 1.6l1.1 2-2.3 2.3-2-1.1c-.5.3-1 .6-1.6.8L13.6 22h-3.2l-.4-2.2a7 7 0 0 1-1.6-.8l-2 1.1-2.3-2.3 1.1-2c-.3-.5-.6-1-.8-1.6L2.2 13.6v-3.2l2.2-.4c.2-.6.5-1.1.8-1.6l-1.1-2 2.3-2.3 2 1.1c.5-.3 1-.6 1.6-.8L10.4 2Z"
      />
      <Circle cx={12} cy={12} r={3.2} fill="rgba(0,0,0,0.6)" />
    </Svg>
  );
}

/**
 * The tabs under a profile: an underline strip, not pills.
 *
 * Equal columns so the strip reads as one control; the active label is ink
 * with a 2 px accent line under it, the rest are muted. One accent only.
 */
export function UnderlineTabs<K extends string>({
  tabs,
  selected,
  onSelect,
}: {
  tabs: ReadonlyArray<{ key: K; label: string }>;
  selected: K;
  onSelect: (key: K) => void;
}) {
  const { colors, width } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        marginTop: 18,
      }}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === selected;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 46,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <BodyStrong
              numberOfLines={1}
              style={{
                fontSize: width < 400 ? 13 : 14,
                lineHeight: 18,
                color: active ? colors.ink : colors.muted,
              }}
            >
              {tab.label}
            </BodyStrong>
            <View
              style={{
                position: 'absolute',
                left: 10,
                right: 10,
                bottom: -1,
                height: 2,
                borderRadius: 1,
                backgroundColor: active ? colors.accent : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small quiet pill under the actions: a shop, a kept list, a notice. */
export function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.sunk : colors.surface,
        justifyContent: 'center',
      })}
    >
      <BodyStrong style={{ fontSize: 13.5, lineHeight: 18, color: colors.ink }}>{label}</BodyStrong>
    </Pressable>
  );
}
