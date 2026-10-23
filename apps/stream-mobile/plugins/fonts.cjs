// Absolute paths of the faces `src/ui/theme.ts` names, for the expo-font
// config plugin: Big Shoulders for display, Atkinson Hyperlegible Next for
// everything else. Embedded on both platforms; iOS addresses a face by its
// PostScript name, Android by its file name.
const files = [
  "@expo-google-fonts/big-shoulders/800ExtraBold/BigShoulders_800ExtraBold.ttf",
  "@expo-google-fonts/big-shoulders/900Black/BigShoulders_900Black.ttf",
  "@expo-google-fonts/atkinson-hyperlegible-next/400Regular/AtkinsonHyperlegibleNext_400Regular.ttf",
  "@expo-google-fonts/atkinson-hyperlegible-next/700Bold/AtkinsonHyperlegibleNext_700Bold.ttf",
];

module.exports = files.map((file) => require.resolve(file));
