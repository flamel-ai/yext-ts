/**
 * Single source of truth for the Yext OpenAPI specs we generate from.
 *
 * The official specs live at https://github.com/yext/openapi (both JSON and
 * YAML). We vendor the JSON copies into `specs/` so generation is reproducible
 * and offline. `fetch-specs.ts` downloads them; `generate.ts` and `tsup.config.ts`
 * read this list.
 */

export interface YextSpec {
  /** File name in the upstream repo's `json/` dir and our local `specs/` dir. */
  file: string;
  /** Sub-module directory under `src/` and the package subpath export. */
  module: string;
  /** JS-identifier namespace used by the root `index.ts` re-export. */
  ns: string;
  /** Human-readable API title (for README + generated headers). */
  title: string;
}

export const SPECS: YextSpec[] = [
  { file: "adminapi.json", module: "admin", ns: "admin", title: "Admin API" },
  { file: "answersapi.json", module: "answers", ns: "answers", title: "Answers API" },
  { file: "chatapi.json", module: "chat", ns: "chat", title: "Chat API" },
  { file: "eventsapi.json", module: "events", ns: "events", title: "Events API" },
  { file: "knowledgeapi.json", module: "knowledge", ns: "knowledge", title: "Knowledge Graph API" },
  { file: "liveapi.json", module: "live", ns: "live", title: "Live API" },
  { file: "publishereclapi.json", module: "publisher-ecl", ns: "publisherEcl", title: "Publisher ECL API" },
  { file: "publisherlistingsapi.json", module: "listings", ns: "listings", title: "Publisher Listings API" },
  { file: "publishernotifyreviewapi.json", module: "publisher-notify-review", ns: "publisherNotifyReview", title: "Publisher Notify Review API" },
  { file: "publishertrackingpixelapi.json", module: "publisher-tracking-pixel", ns: "publisherTrackingPixel", title: "Publisher Tracking Pixel API" },
  { file: "webhooks.json", module: "webhooks", ns: "webhooks", title: "Webhooks API" },
];

/** Raw content base for the upstream `json/` directory. */
export const RAW_BASE = "https://raw.githubusercontent.com/yext/openapi/main/json";
