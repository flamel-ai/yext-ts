# yext-ts

[![CI](https://github.com/flamel-ai/yext-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/flamel-ai/yext-ts/actions/workflows/ci.yml)

A clean, fully-typed TypeScript SDK for the [Yext API](https://hitchhikers.yext.com/docs/), generated from Yext's official [OpenAPI specs](https://github.com/yext/openapi) with [`@hey-api/openapi-ts`](https://heyapi.dev) and [zod](https://zod.dev) validation.

- **All 11 Yext APIs**, one tree-shakeable sub-module each.
- **Typed fetch SDK** — every operation is a typed function.
- **zod schemas** for every model, plus automatic **response validation**.
- **Auth handled for you** — set a credential + API version once.

## Install

```bash
pnpm add @flamel-ai/yext-api
# or: npm install @flamel-ai/yext-api
```

Requires Node 20+. `zod` is a dependency (no peer-install needed).

## Modules

Each Yext API is its own subpath import:

| Import | API | Yext docs |
|---|---|---|
| `@flamel-ai/yext-api/admin` | Admin | [Management APIs](https://hitchhikers.yext.com/docs/managementapis/) |
| `@flamel-ai/yext-api/answers` | Search | [Search](https://hitchhikers.yext.com/docs/search/) |
| `@flamel-ai/yext-api/chat` | Chat | [Chat](https://hitchhikers.yext.com/docs/chat) |
| `@flamel-ai/yext-api/events` | Analytics Events | [Events APIs](https://hitchhikers.yext.com/docs/eventsapis/) |
| `@flamel-ai/yext-api/knowledge` | Knowledge Graph (entities) | [Knowledge Graph](https://hitchhikers.yext.com/docs/knowledge-graph) |
| `@flamel-ai/yext-api/live` | Live (content delivery) | [Content Delivery APIs](https://hitchhikers.yext.com/docs/contentdeliveryapis/) |
| `@flamel-ai/yext-api/listings` | Publisher Listings | [Publisher Listings API](https://hitchhikers.yext.com/publisherapis/publisherlistingsapi) |
| `@flamel-ai/yext-api/publisher-ecl` | Publisher ECL | [Publisher ECL API](https://hitchhikers.yext.com/publisherapis/publishereclapi) |
| `@flamel-ai/yext-api/publisher-notify-review` | Publisher Notify Review | [Publisher Notify Review API](https://hitchhikers.yext.com/publisherapis/publishernotifyreviewapi) |
| `@flamel-ai/yext-api/publisher-tracking-pixel` | Publisher Tracking Pixel | [Publisher Tracking Pixel API](https://hitchhikers.yext.com/publisherapis/publishertrackingpixelapi) |
| `@flamel-ai/yext-api/webhooks` | Webhooks | [Webhooks](https://hitchhikers.yext.com/docs/managementapis/webhooks/) |

The package root (`@flamel-ai/yext-api`) re-exports every module namespaced (`knowledge`, `listings`, …) plus all the auth helpers. Prefer subpath imports for the smallest bundle.

## Authentication

Yext accepts three credential shapes, and **every** request also needs a `v` API-version date (`YYYYMMDD`). `yext-ts` injects both for you at the fetch layer, so you configure once and never thread them through individual calls. See Yext's [Management APIs docs](https://hitchhikers.yext.com/docs/managementapis/) for how credentials and the `v` parameter work.

| Credential | Sent as |
|---|---|
| `{ type: "apiKey", value }` | `api_key` query parameter |
| `{ type: "apiKeyHeader", value }` | `api-key` request header |
| `{ type: "accessToken", value }` | `access_token` query parameter (OAuth) |

### Configure one API's client

```ts
import { client, listEntities } from "@flamel-ai/yext-api/knowledge";
import { configureYextClient } from "@flamel-ai/yext-api";

configureYextClient(client, {
  credential: { type: "apiKey", value: process.env.YEXT_API_KEY! },
  version: "20250401",
});

const { data, error } = await listEntities({ path: { accountId: "me" }, query: {} });
//      ^ fully typed + response-validated; `api_key` and `v` were injected automatically
```

### Configure every API at once

```ts
import { configureYext } from "@flamel-ai/yext-api";

configureYext({
  credential: { type: "accessToken", value: oauthAccessToken },
  version: "20250401",
});
```

### Multi-tenant servers (per-request credentials)

`configureYext` / `configureYextClient` mutate a **shared singleton** client — great for a single-tenant app or script, but **unsafe on a server** where concurrent requests each carry a different Yext token (one request would clobber another's credential mid-flight).

For that case, pass the credential **per call** with `withYextAuth` — no shared state, safe under concurrency:

```ts
import { withYextAuth } from "@flamel-ai/yext-api";
import { getEntity } from "@flamel-ai/yext-api/knowledge";

// inside a request handler — token resolved for THIS tenant/workspace
const { data } = await getEntity({
  path: { accountId: "me", entityId: id },
  query: {},
  ...withYextAuth({ credential: { type: "accessToken", value: req.workspaceYextToken } }),
});
```

Each call gets its own fetch closure carrying that request's token (and version), so two concurrent requests with different tokens never cross over.

### OAuth (authorization-code flow)

```ts
import { buildYextAuthorizeUrl, requestYextOAuthToken } from "@flamel-ai/yext-api";

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
import { schemas } from "@flamel-ai/yext-api/knowledge";

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
import { getYextErrors, getYextWarnings, hasYextErrors, assertYextOk, YextApiError } from "@flamel-ai/yext-api";
import { createEntity } from "@flamel-ai/yext-api/knowledge";

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

The generated `src/**/*.gen.ts` is committed so the SDK is reviewable and usable straight from source. `scripts/normalize-spec.ts` fixes a few upstream spec quirks (wrong-typed `default`s, an invalid query `style: "simple"`, and makes the auto-injected `v` param optional for callers) before generation; the vendored `specs/` stay as the untouched upstream copies.

## Continuous integration & live verification

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and PR:

- **`verify`** (always) — `pnpm install --frozen-lockfile` → `typecheck` → `test` → `build`. No secrets required.
- **`integration`** (pushes to `main` only) — a **real round-trip** against the Yext API via `pnpm test:integration`.

The live test ([`test/integration.test.ts`](test/integration.test.ts)) lists one entity and asserts the response validates against the generated zod schema. It **self-skips** unless a credential is present, so CI stays green until you opt in.

**Enabling the live test without leaking anything (public repo):** add a credential as an encrypted **repository secret** — repo *Settings → Secrets and variables → Actions → New repository secret*:

- `YEXT_API_KEY` (a static API key) **or** `YEXT_ACCESS_TOKEN` (an OAuth token)
- optionally set `YEXT_API_VERSION` / `YEXT_ACCOUNT_ID` as *Variables*

GitHub secrets are encrypted at rest, masked in logs (any echo shows `***`), and **never exposed to pull requests from forks** — so the credential stays private even though the code is public. Run it locally the same way: `YEXT_API_KEY=… pnpm test:integration`.

## Publishing

[`.github/workflows/release.yml`](.github/workflows/release.yml) publishes to npm (with provenance) when you publish a GitHub Release. One-time setup: add an `NPM_TOKEN` automation token as a repository secret. Then:

```bash
pnpm version patch       # or minor / major — bumps + tags
git push --follow-tags
gh release create v0.1.1 --generate-notes
```

The workflow re-runs typecheck + test + build as a gate before `pnpm publish`.

## License

BSD-3-Clause. The vendored OpenAPI specs under `specs/` are from [yext/openapi](https://github.com/yext/openapi) (BSD-3-Clause, © 2021 Yext, Inc.); the SDK code is © 2026 Flamel AI, Inc. Per Yext, only the spec files are covered by this license — use of the Yext API is governed by separate Yext agreements. See [LICENSE](LICENSE).
