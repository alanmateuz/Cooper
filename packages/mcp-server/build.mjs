// Gera dist/index.js (um arquivo só, com dependências) e dist/config.js.
import { build } from "esbuild";

const common = { bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "info" };
// Algumas dependências CJS usam require(); o banner o recria em ESM.
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };

await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js", banner });
await build({ ...common, entryPoints: ["src/config.ts"], outfile: "dist/config.js", banner });
