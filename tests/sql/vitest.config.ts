import { defineConfig } from "vitest/config";

// Testes de SQL no PGlite: offline, sem Supabase.
export default defineConfig({
  test: {
    include: ["tests/sql/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
