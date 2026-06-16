/**
 * Convenience: configure auth for every Yext API client in one call.
 *
 * Hand-written (not generated). Imports each generated module's `client`
 * singleton so a single `configureYext(...)` applies the same credential and
 * API version across all 11 APIs. Importing this pulls in every module — if you
 * only use one API, prefer configuring just its client via `configureYextClient`
 * from a subpath import (e.g. `@flamel-ai/yext-api/knowledge`) to keep your bundle lean.
 */
import { client as adminClient } from "./admin/client.gen.js";
import { client as answersClient } from "./answers/client.gen.js";
import { configureYextClient, type YextAuthOptions } from "./auth.js";
import { client as chatClient } from "./chat/client.gen.js";
import { client as eventsClient } from "./events/client.gen.js";
import { client as knowledgeClient } from "./knowledge/client.gen.js";
import { client as listingsClient } from "./listings/client.gen.js";
import { client as liveClient } from "./live/client.gen.js";
import { client as publisherEclClient } from "./publisher-ecl/client.gen.js";
import { client as publisherNotifyReviewClient } from "./publisher-notify-review/client.gen.js";
import { client as publisherTrackingPixelClient } from "./publisher-tracking-pixel/client.gen.js";
import { client as webhooksClient } from "./webhooks/client.gen.js";

/** Every generated Yext API client, keyed by sub-module name. */
export const yextClients = {
  admin: adminClient,
  answers: answersClient,
  chat: chatClient,
  events: eventsClient,
  knowledge: knowledgeClient,
  listings: listingsClient,
  live: liveClient,
  publisherEcl: publisherEclClient,
  publisherNotifyReview: publisherNotifyReviewClient,
  publisherTrackingPixel: publisherTrackingPixelClient,
  webhooks: webhooksClient,
} as const;

/** Applies the same Yext auth options to every generated API client. */
export function configureYext(options: YextAuthOptions): void {
  for (const client of Object.values(yextClients)) {
    configureYextClient(client, options);
  }
}
