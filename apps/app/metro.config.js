/**
 * Metro, set up for a pnpm monorepo.
 *
 * Two things differ from a standalone app: Metro has to watch the repository
 * root so changes in packages/ reload the app, and it must resolve from both
 * node_modules folders because pnpm does not hoist.
 */

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm symlinks packages, so Metro must not try to resolve through a single
// hoisted tree.
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;

module.exports = withNativeWind(config, { input: './global.css' });
