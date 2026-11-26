// Two apps from one codebase (Android + iOS): the demo build installs next to the live one.
module.exports = ({ config }) => {
  const live = process.env.EXPO_PUBLIC_DATA_MODE === 'firebase';
  return {
    ...config,
    name: live ? config.name : 'Pansari Demo',
    android: { ...config.android, package: live ? config.android.package : `${config.android.package}.demo` },
    ios: { ...config.ios, bundleIdentifier: live ? config.ios.bundleIdentifier : `${config.ios.bundleIdentifier}.demo` },
  };
};
