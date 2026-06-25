import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri ожидает определённый порт в dev-режиме и прокидывает переменные окружения.
// @tauri-apps/cli запускает vite сам при `tauri dev`, поэтому dev-порт должен
// совпадать с devUrl в src-tauri/tauri.conf.json (по умолчанию 1420).
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite настраивается под Tauri:
  // 1. whitelist разрешает корневой путь для ресурсов
  // 2. https://tauri.app/v1/api/config/#build配置devpath
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Не следим за src-tauri — там Rust, ребилдится отдельной командой
      ignored: ["**/src-tauri/**"],
    },
  },
}));
