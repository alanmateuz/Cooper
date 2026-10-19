// Gera dist/index.js (um arquivo só, com dependências), dist/config.js e dist/cooper-statusline.js.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "info",
  define: { __COOPER_VERSION__: JSON.stringify(version) },
};
// Algumas dependências CJS usam require(); o banner o recria em ESM.
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };

await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js", banner });
await build({ ...common, entryPoints: ["src/config.ts"], outfile: "dist/config.js", banner });
await build({ ...common, entryPoints: ["src/cooper-statusline.ts"], outfile: "dist/cooper-statusline.js", banner });
