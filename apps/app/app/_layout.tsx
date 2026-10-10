/**
 * The root of the app.
 *
 * Loads the brand fonts, sets up data fetching, makes sure there is a session
 * even for a first time visitor, and holds the sign in sheet so any screen
 * can ask for an account without owning the flow.
 */

import {
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  useFonts as useCormorant,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts as useDMSans,
} from '@expo-google-fonts/dm-sans';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  useFonts as useJetBrains,
} from '@expo-google-fonts/jetbrains-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthGateProvider } from '../src/components/auth-gate';
import { ApiError } from '../src/lib/api';
import { ensureGuestSession } from '../src/lib/auth';
import { hasSeenWelcome } from '../src/lib/first-run';
import { ThemeProvider, useTheme } from '../src/theme/index';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (failureCount, error) => {
        // Retrying a gate or a validation failure only wastes time.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export default function RootLayout() {
  const [cormorantLoaded] = useCormorant({
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
  });
  const [dmSansLoaded] = useDMSans({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
  const [monoLoaded] = useJetBrains({ JetBrainsMono_400Regular, JetBrainsMono_500Medium });

  const [sessionReady, setSessionReady] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // Every visitor gets a session straight away, so browsing works before
  // anyone has decided to sign up.
  useEffect(() => {
    async function prepare() {
      const [seen] = await Promise.all([
        hasSeenWelcome(),
        ensureGuestSession().catch(() => undefined),
      ]);
      setShowWelcome(!seen);
      setSessionReady(true);
    }

    void prepare();
  }, []);

  const fontsLoaded = cormorantLoaded && dmSansLoaded && monoLoaded;

  useEffect(() => {
    if (fontsLoaded && sessionReady) void SplashScreen.hideAsync();
  }, [fontsLoaded, sessionReady]);

  if (!fontsLoaded || !sessionReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthGateProvider>
              <Shell showWelcome={showWelcome} />
            </AuthGateProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function Shell({ showWelcome }: { showWelcome: boolean }) {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  // First launch opens on the welcome screen, but only when the app was
  // opened normally. Someone following a shared link to a look lands on that
  // look, which is the whole point of sharing one.
  useEffect(() => {
    if (showWelcome && pathname === '/') router.replace('/welcome');
  }, [showWelcome, pathname, router]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.ground);
  }, [colors.ground]);

  return (
    <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.ground },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(main)" />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="product/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="look/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="order/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="lookbook/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="style" options={{ presentation: 'modal' }} />
        <Stack.Screen name="photos" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ presentation: 'card' }} />
        <Stack.Screen name="cart" options={{ presentation: 'modal' }} />
        <Stack.Screen name="checkout" options={{ presentation: 'card' }} />
      </Stack>
    </View>
  );
}
