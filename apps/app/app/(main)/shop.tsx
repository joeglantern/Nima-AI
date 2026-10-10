/**
 * Shop.
 *
 * The masonry grid from the screens: two columns on a phone, three on a
 * tablet, four or five on a desktop. Browsing never asks who you are.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ProductCard } from '../../src/components/cards';
import { EmptyState } from '../../src/components/empty-state';
import { BodyStrong, Caption } from '../../src/components/text';
import { api, type ProductCard as ProductCardData } from '../../src/lib/api';
import { useTheme } from '../../src/theme/index';

const CATEGORIES = [
  { label: 'Everything', value: undefined },
  { label: 'Tops', value: 'TOP' },
  { label: 'Bottoms', value: 'BOTTOM' },
  { label: 'Dresses', value: 'DRESS' },
  { label: 'Shoes', value: 'SHOES' },
  { label: 'Bags', value: 'BAG' },
  { label: 'Jewellery', value: 'JEWELLERY' },
] as const;

export default function ShopScreen() {
  const { colors, gutter, gridColumns, radius, floatingClearance } = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | undefined>();

  const products = useInfiniteQuery({
    queryKey: ['products', query, category],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.products({ q: query || undefined, category, cursor: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = products.data?.pages.flatMap((page) => page.items) ?? [];

  /**
   * Masonry by hand: split into columns and let each card keep its own
   * height. A grid with a fixed row height would crop the clothes, which is
   * the one thing a fashion app cannot do.
   */
  const columns = useMemo(() => {
    const buckets: ProductCardData[][] = Array.from({ length: gridColumns }, () => []);
    for (const [index, item] of items.entries()) buckets[index % gridColumns]?.push(item);
    return buckets;
  }, [items, gridColumns]);

  return (
    <FlatList
      data={[null]}
      keyExtractor={() => 'shop'}
      style={{ width: '100%' }}
      showsVerticalScrollIndicator={false}
      // The grid is rebuilt when the query resolves, so the one cell has to
      // know it is stale.
      extraData={items}
      contentContainerStyle={{ paddingBottom: floatingClearance }}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (products.hasNextPage && !products.isFetchingNextPage) void products.fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 14, paddingBottom: 18, width: '100%' }}>
          <View style={{ paddingHorizontal: gutter }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                // White with a hairline, the way the store screen draws it.
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.pill,
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Circle
                  cx={11}
                  cy={11}
                  r={6.5}
                  stroke={colors.muted}
                  strokeWidth={1.6}
                  fill="none"
                />
                <Path
                  d="m16 16 4 4"
                  stroke={colors.muted}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              </Svg>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search Nima"
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                style={{
                  flex: 1,
                  fontFamily: 'DMSans_400Regular',
                  fontSize: 16,
                  color: colors.ink,
                }}
                accessibilityLabel="Search products"
              />
            </View>
          </View>

          {/*
            Wrapped, not scrolled.

            A horizontal row of seven pills always leaves one cut in half at
            the right edge, and a pill sliced down the middle is the single
            thing that made this screen look unfinished on a phone. Seven of
            them wrap to two lines at phone width and sit on one line from
            tablet up, and nothing is ever clipped.
          */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
              paddingHorizontal: gutter,
            }}
          >
            {CATEGORIES.map((item) => {
              const active = category === item.value;

              return (
                <Pressable
                  key={item.label}
                  onPress={() => setCategory(item.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.line,
                  }}
                >
                  <BodyStrong
                    style={{ fontSize: 14, color: active ? colors.onAccent : colors.ink }}
                  >
                    {item.label}
                  </BodyStrong>
                </Pressable>
              );
            })}
          </View>
        </View>
      }
      renderItem={() => {
        if (products.isLoading) {
          return (
            <View style={{ paddingVertical: 64 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          );
        }

        if (items.length === 0) {
          return (
            <EmptyState
              art="hanger"
              message={
                query
                  ? `Nothing matches "${query}". Try a different word.`
                  : 'No products here yet.'
              }
            />
          );
        }

        return (
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: gutter }}>
            {columns.map((column, index) => (
              // A column has no identity of its own: it is the nth of a fixed
              // number, and that number only changes with the window width.
              // biome-ignore lint/suspicious/noArrayIndexKey: the index is the identity
              <View key={index} style={{ flex: 1, gap: 22 }}>
                {column.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </View>
            ))}
          </View>
        );
      }}
      ListFooterComponent={
        products.isFetchingNextPage ? (
          <View style={{ paddingVertical: 28 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : items.length > 0 ? (
          <View style={{ paddingVertical: 28, alignItems: 'center' }}>
            <Caption>That is everything for now</Caption>
          </View>
        ) : null
      }
    />
  );
}
