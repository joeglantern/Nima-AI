/**
 * Sheet.
 *
 * On a phone this slides up from the bottom, exactly as the screens show. On
 * a wide window it becomes a centred dialog, because a full width sheet on a
 * desktop looks like a mistake.
 *
 * The content behind it stays visible either way. That is the point of the
 * sign in gate: you can see what you are being asked to sign up for.
 */

import { useEffect, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/index';
import { Title } from './text';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Stops a casual tap outside from closing it. */
  dismissable?: boolean;
}

export function Sheet({ open, onClose, title, children, dismissable = true }: SheetProps) {
  const { colors, radius, isCompact, gutter } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // Escape closes it on the web, which people expect from a dialog.
  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) onClose();
    };

    globalThis.addEventListener?.('keydown', handler);
    return () => globalThis.removeEventListener?.('keydown', handler);
  }, [open, dismissable, onClose]);

  return (
    <Modal
      visible={open}
      transparent
      animationType={isCompact ? 'slide' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={dismissable ? onClose : undefined}
        style={{
          flex: 1,
          backgroundColor: colors.scrim,
          justifyContent: isCompact ? 'flex-end' : 'center',
          alignItems: isCompact ? 'stretch' : 'center',
        }}
        accessibilityLabel="Close"
      >
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.ground,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderBottomLeftRadius: isCompact ? 0 : radius.sheet,
            borderBottomRightRadius: isCompact ? 0 : radius.sheet,
            paddingTop: 12,
            paddingBottom: isCompact ? insets.bottom + 24 : 28,
            paddingHorizontal: isCompact ? gutter : 28,
            width: isCompact ? '100%' : 460,
            maxHeight: height * 0.9,
          }}
        >
          {/* The grab handle. Phone only: a dialog does not get dragged. */}
          {isCompact ? (
            <View
              style={{
                alignSelf: 'center',
                width: 44,
                height: 5,
                borderRadius: 999,
                backgroundColor: colors.line,
                marginBottom: 18,
              }}
            />
          ) : null}

          {title ? <Title style={{ marginBottom: 18 }}>{title}</Title> : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12 }}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
