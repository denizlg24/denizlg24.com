import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
