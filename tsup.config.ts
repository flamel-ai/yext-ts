import { defineConfig } from "tsup";

import { SPECS } from "./scripts/specs.js";

// One entry per published surface: the root barrel, the auth helpers, and each
// generated API sub-module. tsup emits ESM + .d.ts into dist/, mirroring the
// exports map in package.json.
const entry: Record<string, string> = {
  index: "src/index.ts",
  auth: "src/auth.ts",
};
for (const { module } of SPECS) {
  entry[`${module}/index`] = `src/${module}/index.ts`;
}

export default defineConfig({
  entry,
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
});
