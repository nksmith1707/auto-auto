// Lets the app use code from apps/shared (the API client and screens both apps share).
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../shared")];
// Files in apps/shared import react, react-native, etc. Resolve those from this app's node_modules.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
