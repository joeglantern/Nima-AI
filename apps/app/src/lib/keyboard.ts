/**
 * Whether the keyboard is up.
 *
 * A screen that has a picture and a field cannot keep both once the
 * keyboard takes half of it. This tells the screen when to let go of the
 * picture, and it changes before the keyboard moves on iOS so the two
 * animate together.
 */

import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';

export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const change = (next: boolean) => () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setShown(next);
    };

    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      change(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      change(false),
    );

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return shown;
}
