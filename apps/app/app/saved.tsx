/**
 * Hung up.
 *
 * Everything you kept: the looks you hung on the hanger and the pieces you
 * loved. Named after the action, so the hanger under a look and this screen
 * are obviously the same thing.
 */

import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { Button } from '../src/components/button';
import { ProductCard } from '../src/components/cards';
import { EmptyState } from '../src/components/empty-state';
import { FeedTile } from '../src/components/feed-post';
import { ScreenHeader } from '../src/components/screen-header';
import { Body, Caption } from '../src/components/text';
import { api } from '../src/lib/api';
import { useSignedIn } from '../src/lib/social';
import { useTheme } from '../src/theme/index';

export default function SavedScreen() {
  const { colors, floatingClearance, isWide } = useTheme();
  const router = useRouter();
  const signedIn = useSignedIn();

  const saved = useQuery({
    queryKey: ['saved'],
    queryFn: api.saved,
    enabled: signedIn,
  });

  const looks = saved.data?.looks ?? [];
  const pieces = saved.data?.pieces ?? [];
  const empty = !saved.isLoading && looks.length === 0 && pieces.length === 0;

  // Two across, in pairs, the same way the feed sets its smaller pages.
  const lookRows: (typeof looks)[] = [];
  for (let at = 0; at < looks.length; at += 2) lookRows.push(looks.slice(at, at + 2));
  const pieceRows: (typeof pieces)[] = [];
  for (let at = 0; at < pieces.length; at += 2) pieceRows.push(pieces.slice(at, at + 2));

  return (
    <>
      <Stack.Screen options={{ title: 'Hung up' }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScreenHeader title="Hung up" />

        {!signedIn ? (
          <EmptyState art="hanger" message="Sign in to keep the looks and pieces you love." />
        ) : saved.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : empty ? (
          <EmptyState
            art="hanger"
            message="Nothing hung up yet. Tap the hanger under a look, or the heart on a piece, and it stays here."
            action={<Button label="Back to For You" full={false} onPress={() => router.back()} />}
          />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingBottom: floatingClearance,
              maxWidth: isWide ? 760 : undefined,
              width: '100%',
              alignSelf: 'center',
              gap: 28,
            }}
            refreshControl={
              <RefreshControl
                refreshing={saved.isRefetching}
                onRefresh={() => void saved.refetch()}
                tintColor={colors.primary}
              />
            }
          >
            {looks.length > 0 ? (
              <View style={{ gap: 20 }}>
                <View style={{ paddingHorizontal: 4, paddingTop: 6 }}>
                  <Body
                    style={{
                      fontFamily: 'CormorantGaramond_500Medium',
                      fontSize: 24,
                      lineHeight: 28,
                    }}
                  >
                    Looks
                  </Body>
                  <Caption>{looks.length === 1 ? '1 look' : `${looks.length} looks`}</Caption>
                </View>
                {lookRows.map((row) => (
                  <View key={row[0]?.id} style={{ flexDirection: 'row', gap: 10 }}>
                    {row.map((look) => (
                      <FeedTile key={look.id} look={look} />
                    ))}
                    {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {pieces.length > 0 ? (
              <View style={{ gap: 20 }}>
                <View style={{ paddingHorizontal: 4, paddingTop: 6 }}>
                  <Body
                    style={{
                      fontFamily: 'CormorantGaramond_500Medium',
                      fontSize: 24,
                      lineHeight: 28,
                    }}
                  >
                    Pieces you love
                  </Body>
                  <Caption>{pieces.length === 1 ? '1 piece' : `${pieces.length} pieces`}</Caption>
                </View>
                {pieceRows.map((row) => (
                  <View key={row[0]?.id} style={{ flexDirection: 'row', gap: 10 }}>
                    {row.map((product) => (
                      <View key={product.id} style={{ flex: 1, minWidth: 0 }}>
                        <ProductCard product={product} />
                      </View>
                    ))}
                    {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </>
  );
}
