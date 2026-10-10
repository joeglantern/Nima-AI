module.exports = (api) => {
  api.cache(true);

  // Plain Expo, no custom JSX runtime.
  //
  // NativeWind was here and this app never wrote a single class name. What
  // it did do was replace the JSX runtime with its own wrapper, which did
  // not pass through a `style` given as a function. React Native Web
  // handled that on its own, so the browser looked right and the phone
  // dropped the styles on every Pressable, which is most of the controls in
  // the app. See docs/DECISIONS.md.
  return {
    presets: ['babel-preset-expo'],
  };
};
