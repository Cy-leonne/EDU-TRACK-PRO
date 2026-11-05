// Metro needs to watch the monorepo root so that the shared @edutrack packages
// (shared-types, shared-config, validation) resolve from their source folders.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
// Nested dependency trees (react-native ships its own node_modules) still need
// Metro's normal hierarchical lookup, so we only add the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// The shared workspace packages are consumed straight from the monorepo (they are
// plain CommonJS builds with type declarations), so the mobile app and the web app
// validate against exactly the same rules. React Native itself is *not* hoisted to
// the repo root: keeping the app's dependencies local means every file Metro
// transforms sits under this directory and picks up this app's babel config.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@edutrack/shared-config': path.resolve(workspaceRoot, 'packages/shared-config'),
  '@edutrack/shared-types': path.resolve(workspaceRoot, 'packages/shared-types'),
  '@edutrack/validation': path.resolve(workspaceRoot, 'packages/validation'),
};

module.exports = config;
