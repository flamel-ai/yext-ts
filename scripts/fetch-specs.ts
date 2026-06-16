/**
 * Downloads the 11 Yext OpenAPI specs from github.com/yext/openapi into
 * `specs/`. Run with `pnpm fetch-specs` to refresh the vendored copies when
 * Yext publishes spec changes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RAW_BASE, SPECS } from "./specs.js";

const here = dirname(fileURLToPath(import.meta.url));
const specsDir = join(here, "..", "specs");

async function main() {
  await mkdir(specsDir, { recursive: true });

  for (const spec of SPECS) {
    const url = `${RAW_BASE}/${spec.file}`;
    process.stdout.write(`Fetching ${spec.file} … `);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    const body = await res.text();
    // Validate it parses as JSON before writing so a partial/HTML error page
    // never lands in specs/.
    JSON.parse(body);
    await writeFile(join(specsDir, spec.file), body, "utf8");
    console.log(`${(body.length / 1024 / 1024).toFixed(2)} MB`);
  }

  console.log(`\nVendored ${SPECS.length} specs into specs/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
