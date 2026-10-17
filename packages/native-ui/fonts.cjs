// Absolute paths of the faces `theme.ts` names, for the expo-font config
// plugin: embedded at build time, so text never renders in the system font
// first.
const files = [
  "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
  "@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf",
  "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
  "@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf",
  "@expo-google-fonts/calistoga/400Regular/Calistoga_400Regular.ttf",
];

module.exports = files.map((file) => require.resolve(file));
