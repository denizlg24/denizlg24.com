// CommonJS: Metro loads its config with require.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Defer each module's evaluation to its first use, so launch runs only what
// the first screen touches instead of every route, schema and sheet.
const getTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);
  return {
    ...options,
    transform: { ...options.transform, inlineRequires: true },
  };
};

module.exports = config;
