/**
 * The two cards the app is mostly made of.
 *
 * ProductCard fills the shop grid. LookCard is the full bleed card in For
 * You, with the three actions underneath and the line of stylist copy, as in
 * the screens.
 */

import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import type { FeedItem, ProductCard as ProductCardData } from '../lib/api';
import { useTheme } from '../theme/index';
import { Body, Caption, Label, Price } from './text';

type LookCardData = Extract<FeedItem, { kind: 'look' }>['look'];

/** A soft placeholder while the photo loads, in the brand ground colour. */
const BLUR = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';

export function ProductCard({ product }: { product: ProductCardData }) {
  const { colors, radius } = useTheme();

  return (
    <Link href={{ pathname: '/product/[id]', params: { id: product.id } }} asChild>
      <Pressable style={{ gap: 8 }} accessibilityRole="link">
        <View
          style={{
            borderRadius: radius.image,
            overflow: 'hidden',
            backgroundColor: colors.sunk,
            aspectRatio: 3 / 4,
          }}
        >
          {product.image ? (
            <Image
              source={{ uri: product.image.url }}
              placeholder={{ blurhash: BLUR }}
              contentFit="cover"
              transition={180}
              style={{ width: '100%', height: '100%' }}
              accessibilityLabel={product.title}
            />
          ) : null}

          {product.promoted ? (
            <View
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                backgroundColor: colors.ground,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: radius.pill,
              }}
            >
              <Label>Promoted</Label>
            </View>
          ) : null}
        </View>

        <View style={{ gap: 2 }}>
          <Body numberOfLines={1}>{product.title}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Price cents={product.priceFromCents} />
            {!product.inStock ? <Caption tone="critical">Sold out</Caption> : null}
          </View>
          <Caption numberOfLines={1}>{product.store.name}</Caption>
        </View>
      </Pressable>
    </Link>
  );
}

function ActionIcon({ name, filled, color }: { name: 'heart' | 'bookmark' | 'comment'; filled: boolean; color: string }) {
  const common = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: filled ? color : 'none',
  };

  if (name === 'heart') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z" {...common} />
      </Svg>
    );
  }

  if (name === 'bookmark') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" {...common} />
      </Svg>
    );
  }

  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M20 12a7 7 0 0 1-9.9 6.4L5 20l1.6-4.6A7 7 0 1 1 20 12Z" {...common} fill="none" />
    </Svg>
  );
}

export interface LookCardProps {
  look: LookCardData;
  onLike?: () => void;
  onSave?: () => void;
  onComment?: () => void;
  /** Full bleed in the feed, contained in a grid. */
  variant?: 'feed' | 'grid';
}

export function LookCard({ look, onLike, onSave, onComment, variant = 'feed' }: LookCardProps) {
  const { colors, radius, isWide } = useTheme();
  const feed = variant === 'feed';

  return (
    <View style={{ gap: 14 }}>
      <Link href={{ pathname: '/look/[id]', params: { id: look.id } }} asChild>
        <Pressable accessibilityRole="link">
          <View
            style={{
              borderRadius: radius.image,
              overflow: 'hidden',
              backgroundColor: colors.sunk,
              aspectRatio: feed ? 4 / 5 : 3 / 4,
              maxHeight: feed && isWide ? 620 : undefined,
            }}
          >
            {look.image ? (
              <Image
                source={{ uri: look.image.url }}
                placeholder={{ blurhash: BLUR }}
                contentFit="cover"
                transition={200}
                style={{ width: '100%', height: '100%' }}
                accessibilityLabel={look.title ?? 'A look on Nima'}
              />
            ) : null}
          </View>
        </Pressable>
      </Link>

      {feed ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
            <ActionPill
              label={look.likedByMe ? 'Loved' : 'Love it'}
              icon={<ActionIcon name="heart" filled={look.likedByMe} color={colors.primary} />}
              onPress={onLike}
            />
            <ActionPill
              label={look.savedByMe ? 'Saved' : 'Save'}
              icon={<ActionIcon name="bookmark" filled={look.savedByMe} color={colors.primary} />}
              onPress={onSave}
            />
            <ActionPill
              label="Comments"
              icon={<ActionIcon name="comment" filled={false} color={colors.primary} />}
              onPress={onComment}
            />
          </View>

          {look.nimaSays ? (
            <View style={{ gap: 4 }}>
              <Label tone="primary">Nima says</Label>
              <Body>{look.nimaSays}</Body>
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ gap: 2 }}>
          {look.title ? <Body numberOfLines={1}>{look.title}</Body> : null}
          <Caption>{`${look.itemCount} ${look.itemCount === 1 ? 'piece' : 'pieces'}`}</Caption>
        </View>
      )}
    </View>
  );
}

function ActionPill({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress?: () => void;
}) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radius.image,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.sunk : 'transparent',
        minWidth: 76,
      })}
    >
      {icon}
      <Label style={{ fontSize: 10, letterSpacing: 1 }}>{label}</Label>
    </Pressable>
  );
}
