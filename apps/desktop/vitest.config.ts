import { defineConfig } from "vitest/config";

// Testes de lógica pura (sem DOM nem Tauri).
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
