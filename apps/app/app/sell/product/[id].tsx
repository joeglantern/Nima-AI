/**
 * Adding a piece, or changing one.
 *
 * Photos first, because they sell it. Then what it is, the price, and how
 * many of each size are on the rail. One price covers every size, which is
 * how almost every shop here prices; the stock is per size.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../../../src/components/button';
import { Chips, Field, TextField } from '../../../src/components/form';
import { ScreenHeader } from '../../../src/components/screen-header';
import { Body, BodyStrong, Caption, Micro } from '../../../src/components/text';
import { ApiError, api, type ProductInput } from '../../../src/lib/api';
import { uploadImage } from '../../../src/lib/upload';
import { useTheme } from '../../../src/theme/index';

const CATEGORIES = [
  { value: 'DRESS', label: 'Dress' },
  { value: 'TOP', label: 'Top' },
  { value: 'BOTTOM', label: 'Trousers and skirts' },
  { value: 'OUTERWEAR', label: 'Jacket' },
  { value: 'SHOES', label: 'Shoes' },
  { value: 'BAG', label: 'Bag' },
  { value: 'JEWELLERY', label: 'Jewellery' },
  { value: 'HEADWEAR', label: 'Headwear' },
  { value: 'ACCESSORY', label: 'Accessory' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'];

const OCCASIONS = [
  { value: 'wedding', label: 'Weddings' },
  { value: 'office', label: 'Office' },
  { value: 'weekend', label: 'Weekend' },
  { value: 'date night', label: 'Date night' },
  { value: 'celebration', label: 'Celebrations' },
  { value: 'holiday', label: 'Holiday' },
];

const COLOURS = [
  'black',
  'white',
  'cream',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'pink',
  'purple',
  'print',
];

const MAX_PHOTOS = 6;

interface Photo {
  /** Stable while the list is reordered or trimmed. */
  id: string;
  url: string;
  storageKey: string | null;
  uploading: boolean;
}

export default function ProductEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { colors, gutter, radius, isWide } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const existing = useQuery({
    queryKey: ['seller-product', id],
    queryFn: () => api.sellerProduct(String(id)),
    enabled: !isNew,
  });

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState<Record<string, number>>({});
  const [variantIds, setVariantIds] = useState<Record<string, string>>({});
  const [colours, setColours] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setPhotos(
      p.images.map((img) => ({
        id: img.storageKey,
        url: img.image.url,
        storageKey: img.storageKey,
        uploading: false,
      })),
    );
    setTitle(p.title);
    setCategory(p.category);
    const active = p.variants.filter((v) => v.isActive);
    const first = active[0];
    if (first) setPrice(String(Math.round(first.priceCents / 100)));
    setStock(Object.fromEntries(active.map((v) => [v.size ?? 'One size', v.stock])));
    setVariantIds(Object.fromEntries(p.variants.map((v) => [v.size ?? 'One size', v.id])));
    setColours(p.colours);
    setOccasions(p.occasions);
    setDescription(p.description ?? '');
  }, [existing.data]);

  const addPhotos = async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.85,
    });
    if (picked.canceled) return;

    const assets = picked.assets.slice(0, room);
    const start = photos.length;
    setPhotos((current) => [
      ...current,
      ...assets.map((asset) => ({
        id: `${asset.uri}-${Math.random().toString(36).slice(2)}`,
        url: asset.uri,
        storageKey: null,
        uploading: true,
      })),
    ]);
    setProblem(null);

    await Promise.all(
      assets.map(async (asset, offset) => {
        try {
          const { storageKey } = await uploadImage(asset, 'PRODUCT_IMAGE');
          setPhotos((current) =>
            current.map((photo, index) =>
              index === start + offset ? { ...photo, storageKey, uploading: false } : photo,
            ),
          );
        } catch (error) {
          setProblem(error instanceof Error ? error.message : 'A photo did not upload');
          setPhotos((current) => current.filter((_, index) => index !== start + offset));
        }
      }),
    );
  };

  const sizesChosen = Object.keys(stock);
  const priceCents = Math.round(Number(price.replace(/[^\d.]/g, '')) * 100);
  const uploading = photos.some((p) => p.uploading);

  const missing = (publish: boolean): string | null => {
    if (title.trim().length < 3) return 'Give it a name';
    if (!category) return 'Choose what kind of piece it is';
    if (!priceCents || priceCents < 100) return 'Add a price';
    if (sizesChosen.length === 0) return 'Choose at least one size';
    if (publish && photos.length === 0) return 'Add at least one photo';
    return null;
  };

  const save = useMutation({
    mutationFn: (publish: boolean) => {
      const body: ProductInput = {
        title: title.trim(),
        description: description.trim() || null,
        category: String(category),
        colours,
        occasions,
        status: publish ? 'ACTIVE' : 'DRAFT',
        variants: sizesChosen.map((size) => ({
          ...(variantIds[size] ? { id: variantIds[size] } : {}),
          size: size === 'One size' ? null : size,
          priceCents,
          stock: stock[size] ?? 0,
        })),
        images: photos.flatMap((p) => (p.storageKey ? [{ storageKey: p.storageKey }] : [])),
      };
      return isNew ? api.createProduct(body) : api.saveProduct(String(id), body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-products'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-store'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-product', id] });
      router.back();
    },
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not save'),
  });

  const submit = (publish: boolean) => {
    const reason = missing(publish);
    if (reason) {
      setProblem(reason);
      return;
    }
    setProblem(null);
    save.mutate(publish);
  };

  if (!isNew && existing.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScreenHeader title="Edit piece" />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: isNew ? 'Add a piece' : 'Edit piece' }} />
      <KeyboardAvoidingView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenHeader title={isNew ? 'Add a piece' : 'Edit piece'} />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingBottom: 48,
            gap: 24,
            maxWidth: isWide ? 680 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <Field label="Photos" note={`${photos.length}/${MAX_PHOTOS}`}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10 }}
            >
              {photos.map((photo, index) => (
                <View key={photo.id} style={{ width: 104, height: 130 }}>
                  <Image
                    source={{ uri: photo.url }}
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: 12,
                      backgroundColor: colors.sunk,
                    }}
                    contentFit="cover"
                  />
                  {index === 0 ? (
                    <View
                      style={{
                        position: 'absolute',
                        left: 6,
                        bottom: 6,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: radius.pill,
                        backgroundColor: colors.scrim,
                      }}
                    >
                      <Micro style={{ color: '#fff' }}>Cover</Micro>
                    </View>
                  ) : null}
                  {photo.uploading ? (
                    <View
                      style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: colors.scrim,
                      }}
                    >
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                      accessibilityRole="button"
                      accessibilityLabel="Remove photo"
                      hitSlop={6}
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: colors.scrim,
                      }}
                    >
                      <Svg width={12} height={12} viewBox="0 0 24 24">
                        <Path
                          d="M6 6l12 12M18 6 6 18"
                          stroke="#fff"
                          strokeWidth={2.6}
                          strokeLinecap="round"
                        />
                      </Svg>
                    </Pressable>
                  )}
                </View>
              ))}
              {photos.length < MAX_PHOTOS ? (
                <Pressable
                  onPress={() => void addPhotos()}
                  accessibilityRole="button"
                  accessibilityLabel="Add photos"
                  style={({ pressed }) => ({
                    width: 104,
                    height: 130,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                    borderColor: colors.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    backgroundColor: pressed ? colors.sunk : colors.surface,
                  })}
                >
                  <Svg width={24} height={24} viewBox="0 0 24 24">
                    <Path
                      d="M12 5v14M5 12h14"
                      stroke={colors.primary}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  </Svg>
                  <Caption>Add photos</Caption>
                </Pressable>
              ) : null}
            </ScrollView>
            <Caption>
              Daylight, a plain wall, the whole piece in frame. Nima evens out the light for you.
            </Caption>
          </Field>

          <Field label="Name">
            <TextField
              value={title}
              onChangeText={setTitle}
              placeholder="For example: Ankara wrap dress"
              maxLength={120}
              accessibilityLabel="Name"
            />
          </Field>

          <Field label="What it is">
            <Chips
              options={CATEGORIES}
              selected={category ? [category] : []}
              onToggle={(value) => setCategory(value)}
            />
          </Field>

          <Field label="Price">
            <View style={{ justifyContent: 'center' }}>
              <Body style={{ position: 'absolute', left: 16, zIndex: 1, color: colors.muted }}>
                KSh
              </Body>
              <TextField
                value={price}
                onChangeText={(text) => setPrice(text.replace(/[^\d]/g, ''))}
                placeholder="4,500"
                keyboardType="number-pad"
                maxLength={7}
                style={{ paddingLeft: 56 }}
                accessibilityLabel="Price in shillings"
              />
            </View>
          </Field>

          <Field label="Sizes and how many you have">
            <Chips
              options={SIZES.map((s) => ({ value: s, label: s }))}
              selected={sizesChosen}
              onToggle={(size) =>
                setStock((current) => {
                  const next = { ...current };
                  if (size in next) delete next[size];
                  else next[size] = 1;
                  return next;
                })
              }
            />
            {sizesChosen.length ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                {SIZES.filter((s) => s in stock).map((size) => (
                  <View
                    key={size}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                      borderRadius: radius.card,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <BodyStrong style={{ flex: 1 }}>{size}</BodyStrong>
                    <Stepper
                      value={stock[size] ?? 0}
                      onChange={(value) => setStock((current) => ({ ...current, [size]: value }))}
                      label={`How many in ${size}`}
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </Field>

          <Field label="Good for">
            <Chips
              options={OCCASIONS}
              selected={occasions}
              onToggle={(value) =>
                setOccasions((current) =>
                  current.includes(value)
                    ? current.filter((o) => o !== value)
                    : [...current, value],
                )
              }
            />
          </Field>

          <Field label="Colours">
            <Chips
              options={COLOURS.map((c) => ({
                value: c,
                label: c.charAt(0).toUpperCase() + c.slice(1),
              }))}
              selected={colours}
              onToggle={(value) =>
                setColours((current) =>
                  current.includes(value)
                    ? current.filter((c) => c !== value)
                    : [...current, value],
                )
              }
            />
          </Field>

          <Field label="Description">
            <TextField
              value={description}
              onChangeText={setDescription}
              placeholder="Fabric, fit, length, how to care for it"
              multiline
              maxLength={4000}
              accessibilityLabel="Description"
            />
          </Field>

          {problem ? (
            <Caption tone="critical" align="center">
              {problem}
            </Caption>
          ) : null}

          <View style={{ gap: 10 }}>
            <Button
              label="Put it in the shop"
              loading={save.isPending && save.variables === true}
              disabled={uploading || save.isPending}
              onPress={() => submit(true)}
            />
            <Button
              label="Save as a draft"
              variant="quiet"
              loading={save.isPending && save.variables === false}
              disabled={uploading || save.isPending}
              onPress={() => submit(false)}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const { colors } = useTheme();

  const button = (glyph: 'minus' | 'plus', next: number, disabled: boolean) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={glyph === 'plus' ? 'One more' : 'One less'}
      hitSlop={6}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.sunk,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Svg width={14} height={14} viewBox="0 0 24 24">
        <Path
          d={glyph === 'plus' ? 'M12 5v14M5 12h14' : 'M5 12h14'}
          stroke={colors.ink}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </Svg>
    </Pressable>
  );

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
      accessibilityLabel={label}
    >
      {button('minus', Math.max(0, value - 1), value <= 0)}
      <BodyStrong style={{ minWidth: 24, textAlign: 'center' }}>{String(value)}</BodyStrong>
      {button('plus', Math.min(999, value + 1), value >= 999)}
    </View>
  );
}
