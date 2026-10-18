import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Lê o .env da raiz, mas expõe ao app SÓ a URL e a chave anon (públicas).
// A service_role nunca entra no bundle.
try {
  loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // sem .env: o app mostra aviso de configuração
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? ""),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ""),
  },
  build: { target: "es2022" },
});
