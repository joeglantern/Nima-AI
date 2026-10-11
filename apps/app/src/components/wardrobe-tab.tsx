/**
 * The wardrobe, inside the profile.
 *
 * Clothes a person already owns, photographed by them. This is the half of
 * Nima that is not a shop: a stylist who can only suggest things you have
 * to buy is a catalogue.
 *
 * Uploading is the whole feature, so the way in is a tile in the grid
 * rather than a button somewhere else. An item appears the moment it is
 * uploaded and quietly swaps to the cut out version when the worker has
 * finished with it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../lib/api';
import { uploadImage } from '../lib/upload';
import { useTheme } from '../theme/index';
import { Body, BodyStrong, Caption, Micro } from './text';

const CATEGORIES = [
  { label: 'Everything', value: undefined },
  { label: 'Tops', value: 'TOP' },
  { label: 'Bottoms', value: 'BOTTOM' },
  { label: 'Dresses', value: 'DRESS' },
  { label: 'Outerwear', value: 'OUTERWEAR' },
  { label: 'Shoes', value: 'SHOES' },
  { label: 'Bags', value: 'BAG' },
] as const;

export function WardrobeTab() {
  const { colors, gutter, radius, gridColumns } = useTheme();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const wardrobe = useQuery({
    queryKey: ['wardrobe', category],
    queryFn: () => api.wardrobe({ category, limit: 50 }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeWardrobeItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wardrobe'] }),
  });

  async function addOne() {
    setProblem(null);

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });

    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;

    setBusy(true);

    try {
      const { storageKey } = await uploadImage(asset, 'WARDROBE_ITEM');
      await api.addWardrobeItem({ storageKey });
      await queryClient.invalidateQueries({ queryKey: ['wardrobe'] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  const items = wardrobe.data?.items ?? [];
  const counts = wardrobe.data?.counts ?? {};
  // Only the categories with something in them, so the filter row is not a
  // line of empty promises.
  const shown = CATEGORIES.filter((entry) => !entry.value || (counts[entry.value] ?? 0) > 0);

  return (
    <View style={{ paddingHorizontal: gutter, paddingTop: 20, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <BodyStrong>What you already own</BodyStrong>
        <Caption>
          Photograph a piece once and Nima can style it, and put it on you, alongside anything in
          the shop. Start with the three things you wear most.
        </Caption>
      </View>

      {shown.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {shown.map((entry) => {
            const active = category === entry.value;

            return (
              <Pressable
                key={entry.label}
                onPress={() => setCategory(entry.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  backgroundColor: active ? colors.accent : colors.surface,
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.line,
                }}
              >
                <BodyStrong style={{ fontSize: 13, color: active ? colors.onAccent : colors.ink }}>
                  {entry.label}
                </BodyStrong>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {problem ? <Body tone="critical">{problem}</Body> : null}

      {wardrobe.isLoading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <AddTile busy={busy} columns={gridColumns} onPress={() => void addOne()} />

          {items.map((item) => (
            <View key={item.id} style={{ width: `${100 / gridColumns}%`, gap: 6 }}>
              <View
                style={{
                  aspectRatio: 3 / 4,
                  borderRadius: radius.image,
                  overflow: 'hidden',
                  backgroundColor: colors.sunk,
                }}
              >
                {item.image ? (
                  <Image
                    source={{ uri: item.image.url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    accessibilityLabel={item.label ?? 'Something you own'}
                  />
                ) : null}

                {item.processing ? (
                  <View
                    style={{
                      position: 'absolute',
                      left: 8,
                      bottom: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: colors.ground,
                    }}
                  >
                    <Micro>Tidying up</Micro>
                  </View>
                ) : null}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Caption numberOfLines={1} style={{ flex: 1 }}>
                  {item.label ?? friendly(item.category)}
                </Caption>

                <Pressable
                  onPress={() => remove.mutate(item.id)}
                  accessibilityLabel="Remove this"
                  hitSlop={8}
                >
                  <Micro tone="muted">Remove</Micro>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** The way in sits in the grid, where the next item would go. */
function AddTile({
  busy,
  columns,
  onPress,
}: {
  busy: boolean;
  columns: number;
  onPress: () => void;
}) {
  const { colors, radius } = useTheme();

  return (
    <View style={{ width: `${100 / columns}%`, gap: 6 }}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Add something you own"
        style={({ pressed }) => ({
          aspectRatio: 3 / 4,
          borderRadius: radius.image,
          borderWidth: 1.5,
          borderColor: pressed ? colors.accent : colors.line,
          backgroundColor: pressed ? colors.accentSoft : colors.sunk,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        })}
      >
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Path
                d="M12 6v12M6 12h12"
                stroke={colors.primary}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </Svg>
            <Micro tone="ink">Add</Micro>
          </>
        )}
      </Pressable>
      <Caption> </Caption>
    </View>
  );
}

function friendly(category: string): string {
  const words: Record<string, string> = {
    TOP: 'Top',
    BOTTOM: 'Bottoms',
    DRESS: 'Dress',
    OUTERWEAR: 'Outerwear',
    SHOES: 'Shoes',
    BAG: 'Bag',
    JEWELLERY: 'Jewellery',
    EYEWEAR: 'Eyewear',
    HEADWEAR: 'Headwear',
    ACCESSORY: 'Accessory',
  };

  return words[category] ?? 'Something you own';
}
