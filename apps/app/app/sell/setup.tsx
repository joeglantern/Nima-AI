/**
 * Opening a shop, or changing its details.
 *
 * Only the name is required. Everything else can come later, and the shop
 * is live as soon as it has a piece in it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
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
import { Button } from '../../src/components/button';
import { Chips, Field, TextField } from '../../src/components/form';
import { ScreenHeader } from '../../src/components/screen-header';
import { Body, Caption, Title } from '../../src/components/text';
import { ApiError, api } from '../../src/lib/api';
import { SELL_HOME } from '../../src/lib/routes';
import { uploadImage } from '../../src/lib/upload';
import { useTheme } from '../../src/theme/index';

const COUNTIES = [
  'Nairobi',
  'Mombasa',
  'Kisumu',
  'Nakuru',
  'Eldoret',
  'Kiambu',
  'Machakos',
  'Other',
];

export default function ShopSetupScreen() {
  const { colors, gutter, isWide } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const current = useQuery({ queryKey: ['seller-store'], queryFn: api.sellerStore });
  const store = current.data?.store ?? null;
  const editing = Boolean(store);

  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [county, setCounty] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState('');
  const [returns, setReturns] = useState('');
  const [logo, setLogo] = useState<{ url: string; key?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!store) return;
    setName(store.name);
    setAbout(store.about ?? '');
    setCounty(store.county);
    setWhatsapp(store.whatsapp ?? '');
    setReturns(store.returnPolicy ?? '');
    setLogo(store.logo ? { url: store.logo.url } : null);
  }, [store]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        about: about.trim() || null,
        county,
        whatsapp: whatsapp.replace(/\s+/g, '') || null,
        returnPolicy: returns.trim() || null,
        ...(logo?.key ? { logoKey: logo.key } : {}),
      };
      return editing ? api.updateStore(body) : api.openStore(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-store'] });
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      if (editing) router.back();
      else router.replace(SELL_HOME);
    },
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not save'),
  });

  // A logo can only be uploaded once the shop exists, because it is stored
  // in the shop's own folder.
  const pickLogo = async () => {
    if (!editing) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;
    setUploading(true);
    setProblem(null);
    try {
      const { storageKey } = await uploadImage(asset, 'STORE_LOGO');
      setLogo({ url: asset.uri, key: storageKey });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That picture did not upload');
    } finally {
      setUploading(false);
    }
  };

  if (current.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScreenHeader title="Your shop" />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Shop details' : 'Open a shop' }} />
      <KeyboardAvoidingView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenHeader title={editing ? 'Shop details' : 'Open a shop'} />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingBottom: 48,
            gap: 22,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          {!editing ? (
            <View style={{ gap: 6, paddingTop: 4 }}>
              <Title style={{ fontSize: 28, lineHeight: 34 }}>Sell on Nima</Title>
              <Body tone="muted">
                People try your pieces on before they buy, so fewer come back. Listing is free. Nima
                keeps a small fee when something sells.
              </Body>
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => void pickLogo()}
                accessibilityRole="button"
                accessibilityLabel="Change shop picture"
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  overflow: 'hidden',
                  backgroundColor: colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {logo ? (
                  <Image
                    source={{ uri: logo.url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                ) : (
                  <Svg width={30} height={30} viewBox="0 0 24 24">
                    <Path
                      d="M4 8h3l2-2.5h6L17 8h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
                      stroke={colors.primary}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </Svg>
                )}
                {uploading ? (
                  <View
                    style={{
                      position: 'absolute',
                      inset: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.scrim,
                    }}
                  >
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </Pressable>
              <Caption>{logo ? 'Tap to change the shop picture' : 'Add a shop picture'}</Caption>
            </View>
          )}

          <Field label="Shop name">
            <TextField
              value={name}
              onChangeText={setName}
              placeholder="What your customers call you"
              autoCapitalize="words"
              maxLength={60}
              accessibilityLabel="Shop name"
            />
          </Field>

          <Field label="About" note={`${about.length}/1000`}>
            <TextField
              value={about}
              onChangeText={setAbout}
              placeholder="What you make or sell, and what makes it yours"
              multiline
              maxLength={1000}
              accessibilityLabel="About the shop"
            />
          </Field>

          <Field label="Where you are">
            <Chips
              label="County"
              options={COUNTIES.map((c) => ({ value: c, label: c }))}
              selected={county ? [county] : []}
              onToggle={(value) => setCounty(county === value ? null : value)}
            />
          </Field>

          <Field label="WhatsApp" note="For buyers with questions">
            <TextField
              value={whatsapp}
              onChangeText={setWhatsapp}
              placeholder="0712 345 678"
              keyboardType="phone-pad"
              maxLength={20}
              accessibilityLabel="WhatsApp number"
            />
          </Field>

          <Field label="Returns">
            <TextField
              value={returns}
              onChangeText={setReturns}
              placeholder="For example: exchanges within 7 days if unworn, with the tag on"
              multiline
              maxLength={2000}
              accessibilityLabel="Return policy"
            />
          </Field>

          {problem ? (
            <Caption tone="critical" align="center">
              {problem}
            </Caption>
          ) : null}

          <Button
            label={editing ? 'Save' : 'Open my shop'}
            loading={save.isPending}
            disabled={name.trim().length < 2 || uploading}
            onPress={() => save.mutate()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
