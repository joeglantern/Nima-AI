/**
 * The style questionnaire.
 *
 * Every answer saves the moment it is given, and the Close button is always
 * there. The brief is firm on this: an unfinished questionnaire must never
 * block anything, so there is no final submit and no progress gate.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { Body, BodyStrong, Caption, Eyebrow, Title } from '../src/components/text';
import { VibeTiles } from '../src/components/vibe-tiles';
import { api } from '../src/lib/api';
import { useTheme } from '../src/theme/index';

const COLOURS = [
  'Black',
  'White',
  'Brown',
  'Cream',
  'Olive',
  'Navy',
  'Burgundy',
  'Rust',
  'Gold',
  'Pink',
];

const OCCASIONS = ['Work', 'Weekend', 'Church', 'Date night', 'Wedding', 'Travel', 'Going out'];

const BUDGETS = [
  { label: 'Under KSh 2,000', min: 0, max: 200_000 },
  { label: 'KSh 2,000 to 5,000', min: 200_000, max: 500_000 },
  { label: 'KSh 5,000 to 10,000', min: 500_000, max: 1_000_000 },
  { label: 'Over KSh 10,000', min: 1_000_000, max: 5_000_000 },
];

export default function StyleScreen() {
  const { colors, gutter, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const profile = useQuery({ queryKey: ['style'], queryFn: api.styleProfile });

  const save = useMutation({
    mutationFn: (answers: Record<string, unknown>) => api.saveStyleAnswers(answers),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['style'] });
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });

  const [aesthetics, setAesthetics] = useState<string[] | null>(null);
  const [colours, setColours] = useState<string[] | null>(null);
  const [occasions, setOccasions] = useState<string[] | null>(null);
  const [budget, setBudget] = useState<number | null>(null);

  const current = {
    aesthetics: aesthetics ?? profile.data?.aesthetics ?? [],
    colours: colours ?? profile.data?.favouriteColours ?? [],
    occasions: occasions ?? profile.data?.occasions ?? [],
  };

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  return (
    <>
      <Stack.Screen options={{ title: 'Your style' }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: 56,
          gap: 32,
          maxWidth: 680,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Eyebrow>{`${profile.data?.completion ?? 0} percent done`}</Eyebrow>
            <Title>What do you like to wear?</Title>
            <Caption>
              Answer what you feel like. You can close this at any point and nothing is lost.
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

        <Section title="Styles you reach for">
          <VibeTiles
            selected={current.aesthetics}
            onToggle={(value) => {
              const next = toggle(current.aesthetics, value);
              setAesthetics(next);
              save.mutate({ aesthetics: next, step: 'style' });
            }}
          />
        </Section>

        <Section title="Colours you wear">
          <Chips
            options={COLOURS}
            selected={current.colours}
            onToggle={(value) => {
              const next = toggle(current.colours, value);
              setColours(next);
              save.mutate({ favouriteColours: next, step: 'colours' });
            }}
          />
        </Section>

        <Section title="What you dress for">
          <Chips
            options={OCCASIONS}
            selected={current.occasions}
            onToggle={(value) => {
              const next = toggle(current.occasions, value);
              setOccasions(next);
              save.mutate({ occasions: next, step: 'occasions' });
            }}
          />
        </Section>

        <Section title="What you usually spend on one piece">
          <View style={{ gap: 8 }}>
            {BUDGETS.map((band, index) => {
              const active =
                budget === index || (budget === null && profile.data?.budgetMaxCents === band.max);

              return (
                <Pressable
                  key={band.label}
                  onPress={() => {
                    setBudget(index);
                    save.mutate({
                      budgetMinCents: band.min,
                      budgetMaxCents: band.max,
                      step: 'budget',
                    });
                  }}
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 14,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.line,
                    backgroundColor: active ? colors.primarySoft : 'transparent',
                  }}
                >
                  <Body>{band.label}</Body>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Button label="Done for now" variant="quiet" onPress={() => router.back()} />
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <BodyStrong>{title}</BodyStrong>
      {children}
    </View>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const { colors, radius } = useTheme();
  const lowered = selected.map((entry) => entry.toLowerCase());

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((option) => {
        const active = lowered.includes(option.toLowerCase());

        return (
          <Pressable
            key={option}
            onPress={() => onToggle(option.toLowerCase())}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.line,
              backgroundColor: active ? colors.primary : 'transparent',
            }}
          >
            <Body style={{ color: active ? colors.onPrimary : colors.ink }}>{option}</Body>
          </Pressable>
        );
      })}
    </View>
  );
}
