import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Em `pnpm dev`, a URL e a chave anon do .env da raiz servem de atalho (pula a tela Setup).
// No build (instalador) ficam vazias: cada pessoa escolhe o próprio servidor no Setup.
// A service_role nunca entra no bundle.
export default defineConfig(({ command }) => {
  if (command === "serve") {
    try {
      loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
    } catch {
      // sem .env: o app abre no Setup
    }
  }
  const dev = command === "serve";
  return {
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    server: { port: 1420, strictPort: true },
    envPrefix: ["VITE_", "TAURI_ENV_"],
    define: {
      __SUPABASE_URL__: JSON.stringify(dev ? (process.env.SUPABASE_URL ?? "") : ""),
      __SUPABASE_ANON_KEY__: JSON.stringify(dev ? (process.env.SUPABASE_ANON_KEY ?? "") : ""),
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
    },
    build: { target: "es2022" },
  };
});
