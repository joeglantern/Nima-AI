/**
 * Send to a friend.
 *
 * The sheet from the design: the people you talk to and follow as circles,
 * a search across everyone, tap a few, add a line, send. Underneath, the
 * way out to WhatsApp and the rest, because that is still where most
 * outfits get discussed, and a guest can use it without an account.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { api, type Peer } from '../lib/api';
import { shareLook } from '../lib/share';
import { useSignedIn } from '../lib/social';
import { useTheme } from '../theme/index';
import { useAuthGate } from './auth-gate';
import { Button } from './button';
import { Avatar } from './feed-post';
import { Sheet } from './sheet';
import { BodyStrong, Caption, Micro } from './text';

export interface SendTarget {
  kind: 'LOOK' | 'PRODUCT';
  id: string;
}

const COLUMNS = 4;

export function SendSheet({ target, onClose }: { target: SendTarget | null; onClose: () => void }) {
  const { colors, radius } = useTheme();
  const signedIn = useSignedIn();
  const { requireAccount } = useAuthGate();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<Map<string, Peer>>(new Map());
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // A fresh sheet each time it opens.
  useEffect(() => {
    if (target) return;
    setQuery('');
    setPicked(new Map());
    setNote('');
    setDone(null);
    setCopied(false);
  }, [target]);

  const people = useQuery({
    queryKey: ['people', debounced],
    queryFn: () => api.people(debounced || undefined),
    enabled: Boolean(target) && signedIn,
  });

  const send = useMutation({
    mutationFn: () =>
      api.shareTo({
        kind: target?.kind ?? 'LOOK',
        refId: String(target?.id),
        userIds: [...picked.keys()],
        note: note.trim() || undefined,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const names = [...picked.values()].map((p) => p.displayName.split(' ')[0]);
      setDone(
        result.sent === 0
          ? 'That could not be sent'
          : names.length === 1
            ? `Sent to ${names[0]}`
            : `Sent to ${names.length} people`,
      );
      setTimeout(onClose, 900);
    },
  });

  const toggle = (person: Peer) => {
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(person.id)) next.delete(person.id);
      else next.set(person.id, person);
      return next;
    });
  };

  // Picked people stay visible while searching for more.
  const listed = people.data?.items ?? [];
  const shown = [
    ...[...picked.values()].filter((p) => !listed.some((l) => l.id === p.id)),
    ...listed,
  ];

  const outside = async () => {
    if (!target || target.kind !== 'LOOK') return;
    try {
      await shareLook(target.id);
      if (Platform.OS === 'web') setCopied(true);
    } catch {
      // Closing the system sheet is not an error worth showing.
    }
  };

  return (
    <Sheet open={Boolean(target)} onClose={onClose} title="Send to">
      {signedIn ? (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              height: 44,
              borderRadius: radius.pill,
              backgroundColor: colors.sunk,
            }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Circle cx={11} cy={11} r={6.5} stroke={colors.muted} strokeWidth={1.7} fill="none" />
              <Path d="m16 16 4 4" stroke={colors.muted} strokeWidth={1.7} strokeLinecap="round" />
            </Svg>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search people"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                fontFamily: 'DMSans_400Regular',
                fontSize: 15,
                color: colors.ink,
                paddingVertical: 0,
              }}
              accessibilityLabel="Search people"
            />
          </View>

          {people.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : shown.length === 0 ? (
            <View style={{ paddingVertical: 18, alignItems: 'center', gap: 4 }}>
              <BodyStrong>{debounced ? 'Nobody by that name' : 'Nobody here yet'}</BodyStrong>
              <Caption align="center">
                {debounced
                  ? 'Try their handle, or send it outside Nima.'
                  : 'Search for a friend by name, or follow people and they will show up here.'}
              </Caption>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
              {shown.slice(0, 16).map((person) => {
                const on = picked.has(person.id);
                return (
                  <Pressable
                    key={person.id}
                    onPress={() => toggle(person)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={person.displayName}
                    style={{ width: `${100 / COLUMNS}%`, alignItems: 'center', gap: 6 }}
                  >
                    <View>
                      <View
                        style={{
                          padding: 2,
                          borderRadius: 999,
                          borderWidth: 2,
                          borderColor: on ? colors.accent : 'transparent',
                        }}
                      >
                        <Avatar url={person.avatar?.url} name={person.displayName} size={58} />
                      </View>
                      {on ? (
                        <View
                          style={{
                            position: 'absolute',
                            right: 0,
                            bottom: 0,
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            backgroundColor: colors.accent,
                            borderWidth: 2,
                            borderColor: colors.surface,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Svg width={12} height={12} viewBox="0 0 24 24">
                            <Path
                              d="m5 12.5 4.5 4.5L19 7.5"
                              stroke={colors.onAccent}
                              strokeWidth={3}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              fill="none"
                            />
                          </Svg>
                        </View>
                      ) : null}
                    </View>
                    <Micro
                      numberOfLines={1}
                      tone="ink"
                      style={{ maxWidth: 76, fontFamily: on ? 'DMSans_600SemiBold' : undefined }}
                    >
                      {person.displayName}
                    </Micro>
                  </Pressable>
                );
              })}
            </View>
          )}

          {picked.size > 0 ? (
            <View style={{ gap: 10 }}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Write a message"
                placeholderTextColor={colors.muted}
                maxLength={500}
                style={{
                  fontFamily: 'DMSans_400Regular',
                  fontSize: 15,
                  color: colors.ink,
                  paddingHorizontal: 16,
                  height: 46,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.surface,
                }}
                accessibilityLabel="Write a message"
              />
              <Button
                label={
                  done ??
                  (picked.size === 1
                    ? `Send to ${[...picked.values()][0]?.displayName.split(' ')[0]}`
                    : `Send to ${picked.size} people`)
                }
                loading={send.isPending}
                disabled={Boolean(done)}
                onPress={() => send.mutate()}
              />
              {send.isError ? (
                <Caption tone="critical" align="center">
                  {send.error instanceof Error ? send.error.message : 'That did not send'}
                </Caption>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ gap: 10, paddingVertical: 4 }}>
          <Caption>Send it to friends on Nima, and talk about it there.</Caption>
          <Button
            label="Sign in to send to friends"
            onPress={() => {
              onClose();
              requireAccount('Create an account to send looks to your friends');
            }}
          />
        </View>
      )}

      {target?.kind === 'LOOK' && picked.size === 0 ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <OutsideButton
            label={
              copied ? 'Link copied' : Platform.OS === 'web' ? 'Copy link' : 'WhatsApp and more'
            }
            onPress={() => void outside()}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

function OutsideButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 46,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.sunk : colors.surface,
      })}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
          stroke={colors.ink}
          strokeWidth={1.7}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <BodyStrong style={{ fontSize: 14 }}>{label}</BodyStrong>
    </Pressable>
  );
}
