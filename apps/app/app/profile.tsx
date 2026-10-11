/**
 * Your profile: the picture, the name and the handle people see.
 *
 * Opened on its own from settings, and once, right after an account is
 * created. Every field is optional. The handle is checked as it is typed,
 * because finding out it is taken after pressing save is the kind of small
 * insult that makes a form feel broken.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { Body, BodyStrong, Caption, Micro, Title } from '../src/components/text';
import { ApiError, api, type ProfileUpdate } from '../src/lib/api';
import { uploadImage } from '../src/lib/upload';
import { useTheme } from '../src/theme/index';

/** Mirrors the server's rule, so the hint appears before the round trip. */
const HANDLE = /^[a-z0-9_.]{3,24}$/;

export default function ProfileScreen() {
  const { colors, gutter, radius, isWide } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  const firstTime = setup === '1';

  const profile = useQuery({ queryKey: ['profile'], queryFn: api.myProfile });

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [wardrobePublic, setWardrobePublic] = useState(false);
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Fill the form once, from what is there. Later refetches must not undo
  // what the person has typed since.
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !profile.data) return;
    filled.current = true;
    const current = profile.data;
    setDisplayName(current.displayName ?? '');
    setHandle(current.handle ?? current.suggestedHandle ?? '');
    setBio(current.bio ?? '');
    setIsPrivate(current.isPrivate);
    setWardrobePublic(current.wardrobePublic);
    setAvatarPreview(current.avatar?.url ?? null);
  }, [profile.data]);

  const handleState = useHandleAvailability(handle, profile.data?.handle);

  const save = useMutation({
    mutationFn: (body: ProfileUpdate) => api.updateProfile(body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
      if (firstTime || !router.canGoBack()) router.replace('/');
      else router.back();
    },
    onError: (error) => {
      setProblem(error instanceof ApiError ? error.message : 'That did not save. Try again.');
    },
  });

  async function pickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setProblem('Nima needs access to your photos to set a picture.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
      exif: false,
    });

    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;

    setUploading(true);
    setProblem(null);

    try {
      const { storageKey } = await uploadImage(asset, 'AVATAR');
      setAvatarKey(storageKey);
      setAvatarPreview(asset.uri);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That picture did not upload');
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    setProblem(null);

    const wanted = handle.trim().toLowerCase();
    if (wanted && !HANDLE.test(wanted)) {
      setProblem('A handle is 3 to 24 characters: letters, numbers, dots and underscores.');
      return;
    }
    if (handleState.kind === 'taken') {
      setProblem('That handle is taken. Pick another.');
      return;
    }

    const body: ProfileUpdate = {
      displayName: displayName.trim() || undefined,
      bio: bio.trim() || null,
      isPrivate,
      wardrobePublic,
    };
    if (wanted && wanted !== profile.data?.handle) body.handle = wanted;
    if (avatarKey) body.avatarKey = avatarKey;

    save.mutate(body);
  }

  const inputStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: colors.ink,
  } as const;

  const initials = (displayName || profile.data?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <Stack.Screen options={{ title: firstTime ? 'Set up your profile' : 'Your profile' }} />

      <KeyboardAvoidingView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: gutter,
            paddingTop: 12,
            paddingBottom: 8,
          }}
        >
          {firstTime ? null : (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              accessibilityLabel="Back"
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.sunk,
              }}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path
                  d="m14 6-6 6 6 6"
                  stroke={colors.ink}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </Pressable>
          )}

          <Title style={{ fontSize: 24, lineHeight: 28, flex: 1 }}>
            {firstTime ? 'Set up your profile' : 'Your profile'}
          </Title>

          {firstTime ? (
            <Button
              label="Later"
              variant="quiet"
              full={false}
              onPress={() => router.replace('/')}
            />
          ) : null}
        </View>

        <ScrollView
          style={{ flex: 1, width: '100%' }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: 48,
            gap: 24,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          {firstTime ? (
            <Body tone="muted">
              This is how you appear on the looks you share. All of it can be changed later.
            </Body>
          ) : null}

          {profile.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <>
              {/* The picture */}
              <View style={{ alignItems: 'center', gap: 10 }}>
                <Pressable
                  onPress={() => void pickAvatar()}
                  accessibilityRole="button"
                  accessibilityLabel={avatarPreview ? 'Change your picture' : 'Add a picture'}
                  disabled={uploading}
                  style={({ pressed }) => ({
                    width: 120,
                    height: 120,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: 60,
                      overflow: 'hidden',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.primarySoft,
                      borderWidth: 4,
                      borderColor: colors.surface,
                    }}
                  >
                    {avatarPreview ? (
                      <Image
                        source={{ uri: avatarPreview }}
                        style={{ width: 112, height: 112 }}
                        contentFit="cover"
                      />
                    ) : (
                      <Title style={{ fontSize: 44, lineHeight: 52, color: colors.primary }}>
                        {initials}
                      </Title>
                    )}
                    {uploading ? (
                      <View
                        style={{
                          position: 'absolute',
                          inset: 0,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'rgba(0,0,0,0.35)',
                        }}
                      >
                        <ActivityIndicator color="#fff" />
                      </View>
                    ) : null}
                  </View>

                  {/* The badge is the one thing on the screen that says "tap me". */}
                  <View
                    style={{
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.accent,
                      borderWidth: 3,
                      borderColor: colors.ground,
                    }}
                  >
                    <CameraMark color={colors.onAccent} />
                  </View>
                </Pressable>

                <Caption>
                  {avatarPreview ? 'Tap the picture to change it' : 'Tap to add a picture'}
                </Caption>
              </View>

              <Field label="Name">
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="What people call you"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  maxLength={50}
                  textContentType="name"
                  style={inputStyle}
                  accessibilityLabel="Name"
                />
              </Field>

              <Field
                label="Handle"
                note={handleNote(handleState).note}
                noteTone={handleNote(handleState).tone}
              >
                <View style={{ position: 'relative', justifyContent: 'center' }}>
                  <Body
                    tone="muted"
                    style={{ position: 'absolute', left: 16, zIndex: 1 }}
                    pointerEvents="none"
                  >
                    @
                  </Body>
                  <TextInput
                    value={handle}
                    onChangeText={(value) =>
                      setHandle(value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))
                    }
                    placeholder="yourname"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={24}
                    style={[inputStyle, { paddingLeft: 34 }]}
                    accessibilityLabel="Handle"
                  />
                </View>
                {handleState.kind === 'taken' && handleState.suggestion ? (
                  <Pressable onPress={() => setHandle(handleState.suggestion ?? '')}>
                    <Caption>
                      Try{' '}
                      <BodyStrong style={{ fontSize: 13 }}>@{handleState.suggestion}</BodyStrong>
                    </Caption>
                  </Pressable>
                ) : null}
              </Field>

              <Field label="About you" note={`${bio.length}/280`}>
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  placeholder="A line or two, if you like"
                  placeholderTextColor={colors.muted}
                  multiline
                  maxLength={280}
                  style={[inputStyle, { minHeight: 92, textAlignVertical: 'top' }]}
                  accessibilityLabel="About you"
                />
              </Field>

              <View style={{ gap: 10 }}>
                <Micro tone="muted">PRIVACY</Micro>
                <Toggle
                  label="Private account"
                  hint="Only people you approve see your looks"
                  value={isPrivate}
                  onChange={setIsPrivate}
                />
                <Toggle
                  label="Show my wardrobe"
                  hint="Let visitors browse what you have saved"
                  value={wardrobePublic}
                  onChange={setWardrobePublic}
                />
              </View>

              {problem ? <Body tone="critical">{problem}</Body> : null}

              <Button
                label={firstTime ? 'Done' : 'Save'}
                loading={save.isPending}
                disabled={uploading || handleState.kind === 'checking'}
                onPress={submit}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

type HandleState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'free' }
  | { kind: 'taken'; suggestion?: string };

/** Is the handle free. Asked a moment after typing stops. */
function useHandleAvailability(handle: string, current: string | null | undefined): HandleState {
  const [state, setState] = useState<HandleState>({ kind: 'idle' });

  useEffect(() => {
    const wanted = handle.trim();
    if (!HANDLE.test(wanted) || wanted === current) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'checking' });
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .handleAvailable(wanted)
        .then((result) => {
          if (cancelled) return;
          setState(
            result.available ? { kind: 'free' } : { kind: 'taken', suggestion: result.suggestion },
          );
        })
        .catch(() => {
          if (!cancelled) setState({ kind: 'idle' });
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, current]);

  return state;
}

/** The small word next to the handle field. */
function handleNote(state: HandleState): { note?: string; tone: 'muted' | 'critical' | 'primary' } {
  switch (state.kind) {
    case 'checking':
      return { note: 'Checking', tone: 'muted' };
    case 'free':
      return { note: 'Available', tone: 'primary' };
    case 'taken':
      return { note: 'Taken', tone: 'critical' };
    default:
      return { tone: 'muted' };
  }
}

function Field({
  label,
  note,
  noteTone = 'muted',
  children,
}: {
  label: string;
  note?: string;
  noteTone?: 'muted' | 'critical' | 'primary';
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Micro tone="muted">{label.toUpperCase()}</Micro>
        {note ? <Micro tone={noteTone}>{note}</Micro> : null}
      </View>
      {children}
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{label}</Body>
        <Micro>{hint}</Micro>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.line }}
        thumbColor="#fff"
        accessibilityLabel={label}
      />
    </View>
  );
}

function CameraMark({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24">
      <Path
        d="M4 8h3l1.6-2.4A1 1 0 0 1 9.4 5h5.2a1 1 0 0 1 .8.4L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill="none"
      />
      <Circle cx={12} cy={13} r={3.2} stroke={color} strokeWidth={1.8} fill="none" />
    </Svg>
  );
}
