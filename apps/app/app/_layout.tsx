/**
 * The root of the app.
 *
 * Loads the brand fonts, sets up data fetching, makes sure there is a session
 * even for a first time visitor, and holds the sign in sheet so any screen
 * can ask for an account without owning the flow.
 */

import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
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
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthGateProvider } from '../src/components/auth-gate';
import { NimaSplash } from '../src/components/nima-splash';
import { ApiError, api } from '../src/lib/api';
import { ensureGuestSession, useSession } from '../src/lib/auth';
import { hasBeenOfferedProfile, hasSeenWelcome, markProfileOffered } from '../src/lib/first-run';
import { reconnectRealtime } from '../src/lib/realtime';
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
    CormorantGaramond_500Medium_Italic,
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

  const ready = fontsLoaded && sessionReady;

  /*
   * The opening scene. On the web it is drawn in public/index.html, before
   * any JavaScript, and fades out here once the app can take over. On the
   * phone the NimaSplash component plays it over the still native splash and
   * tells us when it has left.
   */
  const [splashGone, setSplashGone] = useState(Platform.OS === 'web');

  useEffect(() => {
    if (!ready || Platform.OS !== 'web') return;
    const scene = document.getElementById('nima-splash');
    if (!scene) return;
    scene.classList.add('done');
    const timer = setTimeout(() => scene.remove(), 450);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready && Platform.OS === 'web') return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthGateProvider>
              {ready ? <Shell showWelcome={showWelcome} /> : null}
              {!splashGone ? (
                <NimaSplash
                  ready={ready}
                  fontsReady={fontsLoaded}
                  onGone={() => setSplashGone(true)}
                />
              ) : null}
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

  /*
   * First launch opens on the welcome screen, once.
   *
   * Only when the app was opened normally: someone following a shared link
   * to a look lands on that look, which is the whole point of sharing one.
   *
   * The latch matters. `showWelcome` is read from storage at launch and
   * never changes afterwards, so without it, leaving the welcome screen
   * for the feed put this effect straight back where it started. Signing
   * in bounced you to the welcome screen you had just signed in from.
   */
  const sentToWelcome = useRef(false);

  // Being on the welcome screen counts as having been sent there. A page
  // that reloads while it is up, which phones do when someone goes to read
  // their code, must not treat the sign in that follows as a first launch.
  useEffect(() => {
    if (pathname === '/welcome') sentToWelcome.current = true;
  }, [pathname]);

  useEffect(() => {
    if (sentToWelcome.current || !showWelcome || pathname !== '/') return;
    sentToWelcome.current = true;

    // Read storage again rather than trusting the launch time value. The
    // welcome screen marks itself seen before it leaves, so a fresh read
    // is what tells a first launch from a sign in that just finished.
    let stale = false;
    void hasSeenWelcome().then((seen) => {
      if (!stale && !seen) router.replace('/welcome');
    });

    return () => {
      stale = true;
    };
  }, [showWelcome, pathname, router]);

  // The live connection carries whoever was signed in when it opened, so a
  // new session (guest to account, or signing out) gets a new socket.
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    reconnectRealtime(userId);
  }, [userId]);

  /*
   * The first thing after creating an account is the setup list: a name and
   * handle, a few style answers, a photo to be dressed, a password if wanted.
   *
   * Once, per account, and not while the welcome screen is still up, since
   * that screen is about to move to the feed itself and would replace this.
   * Everything on the profile screen is optional and it can be left at
   * once; the point is that a new person is shown where it is.
   */
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const viewer = bootstrap.data?.user;
  const offeredSetupTo = useRef<string | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isAnonymous || viewer.handle !== null) return;
    if (pathname === '/welcome' || pathname === '/setup' || pathname === '/profile') return;
    // Mid purchase at a booth, with a queue behind them. It can wait.
    if (pathname.startsWith('/booth')) return;
    if (offeredSetupTo.current === viewer.id) return;
    offeredSetupTo.current = viewer.id;

    let stale = false;
    void hasBeenOfferedProfile(viewer.id).then((offered) => {
      if (stale || offered) return;
      void markProfileOffered(viewer.id);
      router.push('/setup');
    });

    return () => {
      stale = true;
    };
  }, [viewer, pathname, router]);

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
        <Stack.Screen name="setup" options={{ presentation: 'card' }} />
        <Stack.Screen name="password" options={{ presentation: 'card' }} />
        <Stack.Screen name="u/[handle]" options={{ presentation: 'card' }} />
        <Stack.Screen name="activity" options={{ presentation: 'card' }} />
        <Stack.Screen name="circle" options={{ presentation: 'card' }} />
        <Stack.Screen name="saved" options={{ presentation: 'card' }} />
        <Stack.Screen name="messages/index" options={{ presentation: 'card' }} />
        <Stack.Screen name="messages/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="sell/index" options={{ presentation: 'card' }} />
        <Stack.Screen name="sell/setup" options={{ presentation: 'card' }} />
        <Stack.Screen name="sell/product/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="s/[slug]" options={{ presentation: 'card' }} />
        <Stack.Screen name="cart" options={{ presentation: 'card' }} />
        <Stack.Screen name="checkout" options={{ presentation: 'card' }} />
        <Stack.Screen name="booth/[slug]" options={{ presentation: 'card' }} />
        <Stack.Screen name="booth/receipt/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="sell/booth" options={{ presentation: 'card' }} />
      </Stack>
    </View>
  );
}
