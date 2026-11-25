// Metro: watch the monorepo packages this app imports (@pansari/client, shared, adapters)
// and resolve their dependencies from the repo root as well as this app.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.join(root, 'packages'), path.join(root, 'services'), path.join(root, 'node_modules')];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')];
// One copy of React / React Native only — always this app's.
config.resolver.extraNodeModules = {
  react: path.join(__dirname, 'node_modules/react'),
  'react-native': path.join(__dirname, 'node_modules/react-native'),
};
config.resolver.unstable_enablePackageExports = true;
// pdf-lib (used for invoice PDFs) does `import tslib from 'tslib'`; the CommonJS build
// Metro picks has no default export. Point every tslib import at the ES build, which has one.
const tslibEs = path.join(root, 'node_modules/tslib/tslib.es6.mjs');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (name === 'tslib') return { type: 'sourceFile', filePath: tslibEs };
  return (upstream ?? ctx.resolveRequest)(ctx, name, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
