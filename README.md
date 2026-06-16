# yext-ts

A clean, fully-typed TypeScript SDK for the [Yext API](https://hitchhikers.yext.com/docs/), generated from Yext's official [OpenAPI specs](https://github.com/yext/openapi) with [`@hey-api/openapi-ts`](https://heyapi.dev) and [zod](https://zod.dev) validation.

- **All 11 Yext APIs**, one tree-shakeable sub-module each.
- **Typed fetch SDK** — every operation is a typed function.
- **zod schemas** for every model, plus automatic **response validation**.
- **Auth handled for you** — set a credential + API version once.

## Install

```bash
npm install yext-ts
# or: pnpm add yext-ts
```

Requires Node 20+. `zod` is a dependency (no peer-install needed).

## Modules

Each Yext API is its own subpath import:

| Import | API | Yext docs |
|---|---|---|
| `yext-ts/admin` | Admin | [Management APIs](https://hitchhikers.yext.com/docs/managementapis/) |
| `yext-ts/answers` | Search | [Search](https://hitchhikers.yext.com/docs/search/) |
| `yext-ts/chat` | Chat | [Chat](https://hitchhikers.yext.com/docs/chat) |
| `yext-ts/events` | Analytics Events | [Events APIs](https://hitchhikers.yext.com/docs/eventsapis/) |
| `yext-ts/knowledge` | Knowledge Graph (entities) | [Knowledge Graph](https://hitchhikers.yext.com/docs/knowledge-graph) |
| `yext-ts/live` | Live (content delivery) | [Content Delivery APIs](https://hitchhikers.yext.com/docs/contentdeliveryapis/) |
| `yext-ts/listings` | Publisher Listings | [Publisher Listings API](https://hitchhikers.yext.com/publisherapis/publisherlistingsapi) |
| `yext-ts/publisher-ecl` | Publisher ECL | [Publisher ECL API](https://hitchhikers.yext.com/publisherapis/publishereclapi) |
| `yext-ts/publisher-notify-review` | Publisher Notify Review | [Publisher Notify Review API](https://hitchhikers.yext.com/publisherapis/publishernotifyreviewapi) |
| `yext-ts/publisher-tracking-pixel` | Publisher Tracking Pixel | [Publisher Tracking Pixel API](https://hitchhikers.yext.com/publisherapis/publishertrackingpixelapi) |
| `yext-ts/webhooks` | Webhooks | [Webhooks](https://hitchhikers.yext.com/docs/managementapis/webhooks/) |

The package root (`yext-ts`) re-exports every module namespaced (`knowledge`, `listings`, …) plus all the auth helpers. Prefer subpath imports for the smallest bundle.

## Authentication

Yext accepts three credential shapes, and **every** request also needs a `v` API-version date (`YYYYMMDD`). `yext-ts` injects both for you at the fetch layer, so you configure once and never thread them through individual calls. See Yext's [Management APIs docs](https://hitchhikers.yext.com/docs/managementapis/) for how credentials and the `v` parameter work.

| Credential | Sent as |
|---|---|
| `{ type: "apiKey", value }` | `api_key` query parameter |
| `{ type: "apiKeyHeader", value }` | `api-key` request header |
| `{ type: "accessToken", value }` | `access_token` query parameter (OAuth) |

### Configure one API's client

```ts
import { client, listEntities } from "yext-ts/knowledge";
import { configureYextClient } from "yext-ts";

configureYextClient(client, {
  credential: { type: "apiKey", value: process.env.YEXT_API_KEY! },
  version: "20250401",
});

const { data, error } = await listEntities({ path: { accountId: "me" }, query: {} });
//      ^ fully typed + response-validated; `api_key` and `v` were injected automatically
```

### Configure every API at once

```ts
import { configureYext } from "yext-ts";

configureYext({
  credential: { type: "accessToken", value: oauthAccessToken },
  version: "20250401",
});
```

### OAuth (authorization-code flow)

```ts
import { buildYextAuthorizeUrl, requestYextOAuthToken } from "yext-ts";

// 1. Send the user here to authorize your app:
const authUrl = buildYextAuthorizeUrl({
  clientId: process.env.YEXT_CLIENT_ID!,
  redirectUri: "https://app.example.com/yext/callback",
  scope: "read_entities write_entities",
});

// 2. In your redirect handler, exchange the `?code=...`:
const token = await requestYextOAuthToken({
  clientId: process.env.YEXT_CLIENT_ID!,
  clientSecret: process.env.YEXT_CLIENT_SECRET!,
  code: codeFromCallback,
  redirectUri: "https://app.example.com/yext/callback",
});

configureYext({ credential: { type: "accessToken", value: token.access_token } });
```

Use `environment: "sandbox"` on any of these helpers to target Yext's sandbox OAuth hosts.

## zod schemas

Every model has a generated zod schema, exposed under each module's `schemas` namespace:

```ts
import { schemas } from "yext-ts/knowledge";

const result = schemas.zEntityWrite.safeParse(payload);
if (!result.success) console.error(result.error);
```

Response bodies are validated against these schemas automatically. Request bodies are **not** validated client-side (the API validates them), which is what lets auth + version inject transparently.

## Error handling

Yext doesn't signal every problem with the HTTP status. Each response carries a `meta` envelope, and problems are listed in `meta.errors[]`, each tagged with a `type` ([docs](https://hitchhikers.yext.com/docs/managementapis/introduction/errors)):

| `type` | HTTP | Meaning |
|---|---|---|
| `WARNING` | 200 | Accepted, but didn't follow best practices |
| `NON_FATAL_ERROR` | 207 | Some item/field rejected, others succeeded |
| `FATAL_ERROR` | 400 / 401 / 403 / 409 / 5xx | The whole request was rejected |

So a warning rides along on a `200` and a non-fatal error on a `207` — checking `response.ok` alone misses both. SDK calls return `{ data, error, response }` (no throw by default); these helpers read `meta.errors` from either body:

```ts
import { getYextErrors, getYextWarnings, hasYextErrors, assertYextOk, YextApiError } from "yext-ts";
import { createEntity } from "yext-ts/knowledge";

const result = await createEntity({ path: { accountId: "me" }, query: {}, body: { /* ... */ } });

for (const w of getYextWarnings(result)) console.warn(`Yext warning ${w.code}: ${w.message}`);

if (hasYextErrors(result)) {
  // FATAL_ERROR, NON_FATAL_ERROR (207), a >= 400 status, or a populated `error` body
  const errors = getYextErrors(result);
  // handle...
}
```

Prefer throwing? `assertYextOk` returns the result on success (warnings don't throw) and throws a `YextApiError` — carrying `status`, `uuid`, and the parsed `issues[]` — otherwise:

```ts
try {
  const { data } = assertYextOk(await getEntity({ path: { accountId: "me", entityId: "loc-1" }, query: {} }));
  // data is the validated success body
} catch (err) {
  if (err instanceof YextApiError) {
    console.error(err.status, err.uuid, err.issues); // 404, "uuid…", [{ code, type, message }]
  }
}
```

Success-response **bodies are validated** against the generated zod schemas automatically; if Yext returns a body that doesn't match the spec, the SDK surfaces a zod error in `result.error`.

## Per-call overrides

Anything you pass on a call wins over the injected defaults — e.g. pass `query: { v: "20240101" }` to pin a different version for one request, or `auth`/`baseUrl` via the client config.

## Development

```bash
pnpm install
pnpm fetch-specs   # vendor the 11 specs from github.com/yext/openapi into specs/
pnpm generate      # normalize specs + regenerate src/<module>/*.gen.ts
pnpm typecheck
pnpm test
pnpm build         # emit dist/ (ESM + .d.ts)
```

The generated `src/**/*.gen.ts` is committed so the SDK is reviewable and usable straight from source. `scripts/normalize-spec.ts` fixes a few upstream spec quirks (wrong-typed `default`s, an invalid query `style: "simple"`) before generation; the vendored `specs/` stay as the untouched upstream copies.

## License

MIT
