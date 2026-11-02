/**
 * A link that goes nowhere.
 *
 * Old links, typos and looks that were taken down all land here. It says so
 * in Nima's voice and offers the one thing that always works, the feed.
 */

import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '../src/components/button';
import { EmptyState } from '../src/components/empty-state';
import { useTheme } from '../src/theme/index';

export default function NotFoundScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: 'Page not found' }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground, justifyContent: 'center' }}>
        <EmptyState
          art="hanger"
          message="There is nothing at this address. It may have been taken down, or the link was typed wrong."
          action={<Button label="Back to For You" full={false} onPress={() => router.replace('/')} />}
        />
      </View>
    </>
  );
}
