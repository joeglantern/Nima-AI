/**
 * Setting up, after an account is made.
 *
 * Not a wizard. A short list, every line optional, each opening the screen
 * that already does the job and coming back here when it is done. The
 * photo is drawn larger than the rest because it is the step that turns
 * Nima from a shop into a mirror, and most people do not know that yet.
 *
 * Opened once by itself after sign up, and from Settings or the store page
 * until the list is finished.
 */

import { Stack, useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { Mascot } from '../src/components/mascot';
import { Body, BodyStrong, Caption, Micro, Title } from '../src/components/text';
import { type SetupStep, useSetupProgress } from '../src/lib/setup';
import { elevation } from '../src/theme/elevation';
import { useTheme } from '../src/theme/index';

export default function SetupScreen() {
  const { colors, gutter, isWide } = useTheme();
  const router = useRouter();
  const setup = useSetupProgress();

  const next = setup.steps.find((step) => !step.done);

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Set yourself up' }} />

      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: gutter,
            paddingTop: 20,
            paddingBottom: 48,
            gap: 18,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Title>{setup.complete ? 'All set' : 'Set yourself up'}</Title>
              <Body tone="muted">
                {setup.complete
                  ? 'Nima has what it needs. Everything here can be changed in Settings.'
                  : 'Four small things, all optional. Each one makes Nima better at you.'}
              </Body>
            </View>
            <Mascot size={84} mood={setup.complete ? 'delighted' : 'happy'} />
          </View>

          {/* Progress, as a row of four marks rather than a percentage. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {setup.steps.map((step) => (
              <View
                key={step.key}
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: step.done ? colors.primary : colors.line,
                }}
              />
            ))}
            <Micro style={{ marginLeft: 6 }}>{`${setup.done} of ${setup.total}`}</Micro>
          </View>

          {setup.steps.map((step) => (
            <StepCard
              key={step.key}
              step={step}
              onPress={() => router.push(step.href)}
              emphasised={step.hero && !step.done}
            />
          ))}

          <View style={{ gap: 10, marginTop: 6 }}>
            {next ? (
              <Button
                label={`Next: ${next.title.toLowerCase()}`}
                onPress={() => router.push(next.href)}
              />
            ) : null}
            <Button
              label={setup.complete ? 'Done' : 'Later'}
              variant={setup.complete ? 'primary' : 'quiet'}
              onPress={leave}
            />
          </View>

          <Caption align="center">
            Nima works without any of this. These only make it better.
          </Caption>
        </ScrollView>
      </View>
    </>
  );
}

function StepCard({
  step,
  onPress,
  emphasised = false,
}: {
  step: SetupStep;
  onPress: () => void;
  emphasised?: boolean;
}) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ checked: step.done }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: emphasised ? 18 : 14,
        borderRadius: radius.card,
        backgroundColor: emphasised ? colors.espresso : pressed ? colors.sunk : colors.surface,
        ...(emphasised ? elevation('raised') : {}),
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: step.done
            ? colors.positive
            : emphasised
              ? colors.accent
              : colors.primarySoft,
        }}
      >
        {step.done ? (
          <Svg width={16} height={16} viewBox="0 0 24 24">
            <Path
              d="m5 12 5 5 9-10"
              stroke="#fff"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        ) : (
          <Svg width={16} height={16} viewBox="0 0 24 24">
            <Path
              d="m10 6 6 6-6 6"
              stroke={emphasised ? colors.onAccent : colors.primary}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        )}
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <BodyStrong style={emphasised ? { color: colors.onEspresso } : undefined}>
          {step.title}
        </BodyStrong>
        <Caption style={emphasised ? { color: colors.onEspresso, opacity: 0.8 } : undefined}>
          {step.done ? 'Done. Tap to change it.' : step.detail}
        </Caption>
      </View>
    </Pressable>
  );
}
