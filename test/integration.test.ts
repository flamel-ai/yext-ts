/**
 * Live Yext round-trip. Skipped unless a credential is provided via env, so it
 * never runs (or needs secrets) in normal local/PR runs. In CI it runs against
 * real Yext using an encrypted repository secret — see .github/workflows/ci.yml.
 *
 * Set one of:
 *   YEXT_API_KEY=...        (static API key)
 *   YEXT_ACCESS_TOKEN=...   (OAuth access token)
 * Optional: YEXT_API_VERSION=YYYYMMDD, YEXT_ACCOUNT_ID (defaults to "me").
 *
 * Read-only: it lists a single entity and asserts the response validates.
 */
import { describe, expect, it } from "vitest";

import { withYextAuth, type YextCredential } from "../src/index.js";
import { listEntities } from "../src/knowledge/index.js";

const apiKey = process.env.YEXT_API_KEY;
const accessToken = process.env.YEXT_ACCESS_TOKEN;
const version = process.env.YEXT_API_VERSION;
const accountId = process.env.YEXT_ACCOUNT_ID ?? "me";

const credential: YextCredential | undefined = apiKey
  ? { type: "apiKey", value: apiKey }
  : accessToken
    ? { type: "accessToken", value: accessToken }
    : undefined;

describe.skipIf(!credential)("live Yext Knowledge API round-trip", () => {
  it("lists entities and the response validates against the generated schema", async () => {
    const { data, error, response } = await listEntities({
      path: { accountId },
      query: { limit: 1 },
      ...withYextAuth({ credential: credential!, ...(version ? { version } : {}) }),
    });

    expect(error, `Yext returned an error: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response?.status).toBe(200);
    expect(data?.meta?.uuid, "expected a meta.uuid on the response").toBeTruthy();
    expect(Array.isArray(data?.response?.entities)).toBe(true);
  });
});
