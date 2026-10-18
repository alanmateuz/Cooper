import { loadEnvFile } from "node:process";
import { defineConfig } from "vitest/config";

for (const f of [".env", ".env.local"]) {
  try {
    loadEnvFile(f);
  } catch {
    // ausente: os testes avisam o que falta
  }
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
