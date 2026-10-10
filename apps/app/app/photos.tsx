/**
 * Your photos.
 *
 * Two kinds, because they do different jobs: a full body shot for outfits,
 * and a head and shoulders one for jewellery and sunglasses.
 *
 * The upload goes straight from the phone to storage. The image never passes
 * through Nima's server, and the photos are private: nothing here is ever
 * published without being shared deliberately.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Body, BodyStrong, Caption, Micro, Title } from '../src/components/text';
import { api } from '../src/lib/api';
import { useTheme } from '../src/theme/index';

type PhotoKind = 'FULL_BODY' | 'UPPER_BODY';

export default function PhotosScreen() {
  const { colors, gutter } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<PhotoKind | null>(null);

  const photos = useQuery({ queryKey: ['photos'], queryFn: api.photos });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePhoto(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
  });

  async function pickAndUpload(kind: PhotoKind) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Nima needs access to your photos', 'You can change this in settings.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
      exif: false,
    });

    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;

    setBusy(kind);

    try {
      const file = await fetch(asset.uri);
      const blob = await file.blob();

      const ticket = await api.createUpload({
        purpose: 'USER_PHOTO',
        contentType: blob.type || 'image/jpeg',
        size: blob.size,
      });

      const upload = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: ticket.headers,
        body: blob,
      });

      if (!upload.ok) throw new Error('The upload did not finish');

      await api.savePhoto({
        storageKey: ticket.storageKey,
        kind,
        width: asset.width,
        height: asset.height,
        makeDefault: true,
      });

      await queryClient.invalidateQueries({ queryKey: ['photos'] });
    } catch (error) {
      Alert.alert(
        'That photo did not upload',
        error instanceof Error ? error.message : 'Try again in a moment.',
      );
    } finally {
      setBusy(null);
    }
  }

  const items = photos.data?.items ?? [];
  const fullBody = items.filter((photo) => photo.kind === 'FULL_BODY');
  const upperBody = items.filter((photo) => photo.kind === 'UPPER_BODY');

  return (
    <>
      <Stack.Screen options={{ title: 'Your photos' }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: 56,
          gap: 28,
          maxWidth: 680,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Title>Your photos</Title>
            <Caption>
              Only you see these. They are used to show clothes on you, and nothing else.
            </Caption>
          </View>

          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Close"
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.sunk,
            }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path
                d="m7 7 10 10M17 7 7 17"
                stroke={colors.ink}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
        </View>

        {photos.isLoading ? <ActivityIndicator color={colors.primary} /> : null}

        <PhotoGroup
          title="Full body"
          hint="For outfits. Stand facing the camera, whole body in frame."
          photos={fullBody}
          busy={busy === 'FULL_BODY'}
          onAdd={() => void pickAndUpload('FULL_BODY')}
          onRemove={(id) => remove.mutate(id)}
        />

        <PhotoGroup
          title="Head and shoulders"
          hint="For jewellery, sunglasses and anything worn above the neck."
          photos={upperBody}
          busy={busy === 'UPPER_BODY'}
          onAdd={() => void pickAndUpload('UPPER_BODY')}
          onRemove={(id) => remove.mutate(id)}
        />

        {items.length === 0 && !photos.isLoading ? (
          <Caption align="center" style={{ paddingTop: 4 }}>
            One photo is enough to start. You can add the other later.
          </Caption>
        ) : null}
      </ScrollView>
    </>
  );
}

function PhotoGroup({
  title,
  hint,
  photos,
  busy,
  onAdd,
  onRemove,
}: {
  title: string;
  hint: string;
  photos: Array<{ id: string; url: string; checkState: string; checkNote: string | null }>;
  busy: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const { colors, radius } = useTheme();

  return (
    // A card, so the two groups read as two things rather than as a list of
    // headings with a dashed box adrift beside each one.
    <View
      style={{
        gap: 14,
        padding: 16,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ gap: 2 }}>
        <BodyStrong>{title}</BodyStrong>
        <Caption>{hint}</Caption>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {photos.map((photo) => (
          <View key={photo.id} style={{ width: 108, gap: 6 }}>
            <View
              style={{
                width: 108,
                height: 144,
                borderRadius: radius.image,
                overflow: 'hidden',
                backgroundColor: colors.sunk,
              }}
            >
              <Image
                source={{ uri: photo.url }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            </View>

            {photo.checkState === 'FAILED' ? (
              <Caption tone="critical" numberOfLines={2}>
                {photo.checkNote ?? 'This one will not work well'}
              </Caption>
            ) : null}

            <Pressable onPress={() => onRemove(photo.id)} accessibilityLabel="Delete this photo">
              <Micro tone="critical">Delete</Micro>
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={onAdd}
          disabled={busy}
          accessibilityLabel={`Add a ${title.toLowerCase()} photo`}
          style={({ pressed }) => ({
            width: 108,
            height: 144,
            borderRadius: radius.image,
            // Not dashed: Android draws a dashed border solid as soon as
            // there is a corner radius, so the same tile would be dashed in
            // a browser and solid on a phone.
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
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <Path
                  d="M12 6v12M6 12h12"
                  stroke={colors.primary}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              </Svg>
              <Body tone="primary" style={{ fontSize: 14 }}>
                Add
              </Body>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}
