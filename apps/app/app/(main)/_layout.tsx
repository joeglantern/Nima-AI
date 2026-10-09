/**
 * The main shell.
 *
 * The same three destinations, arranged by how much room there is:
 *
 *   phone    pills across the top, exactly as the screens show
 *   tablet   a left rail
 *   desktop  a left sidebar, with the content centred beside it
 *
 * The decision is made on window width, not platform, so a narrow browser
 * window behaves like a phone and an iPad never gets a stretched phone
 * layout, which is what Apple rejected the previous app for.
 */

import { View } from 'react-native';
import { Slot } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/index';
import { Sidebar, TopPills } from '../../src/components/top-nav';
import { useRealtimeConnection } from '../../src/lib/realtime';

export default function MainLayout() {
  const { colors, isCompact, layout } = useTheme();
  const insets = useSafeAreaInsets();

  // One socket for the whole session, opened while the app is in front.
  useRealtimeConnection(true);

  if (isCompact) {
    return (
      <View
        style={{
          flex: 1,
          width: '100%',
          backgroundColor: colors.ground,
          paddingTop: insets.top,
        }}
      >
        <TopPills />
        <View style={{ flex: 1, width: '100%' }}>
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, width: '100%', flexDirection: 'row', backgroundColor: colors.ground }}
    >
      <Sidebar />
      <View style={{ flex: 1 }}>
        {/* The content column stays readable however wide the window gets. */}
        <View
          style={{
            flex: 1,
            width: '100%',
            maxWidth: layout === 'desktop' ? 1180 : undefined,
            alignSelf: 'center',
          }}
        >
          <Slot />
        </View>
      </View>
    </View>
  );
}
