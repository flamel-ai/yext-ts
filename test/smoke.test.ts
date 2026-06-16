import { describe, expect, it, vi } from "vitest";

import {
  assertYextOk,
  buildYextAuthorizeUrl,
  withYextAuth,
  configureYext,
  configureYextClient,
  createYextFetch,
  DEFAULT_API_VERSION,
  getYextErrors,
  getYextWarnings,
  hasYextErrors,
  YextApiError,
  yextClients,
} from "../src/index.js";
import { getEntity, listEntities, schemas, client as knowledgeClient } from "../src/knowledge/index.js";

describe("generated knowledge SDK surface", () => {
  it("exports SDK functions and a configurable client", () => {
    expect(typeof getEntity).toBe("function");
    expect(typeof listEntities).toBe("function");
    expect(typeof knowledgeClient.setConfig).toBe("function");
    expect(typeof knowledgeClient.getConfig).toBe("function");
  });

  it("exposes zod schemas under the `schemas` namespace", () => {
    // zLocationType is a small enum schema present in the knowledge spec.
    expect(schemas.zLocationType).toBeDefined();
    const parsed = schemas.zLocationType.safeParse("LOCATION");
    expect(parsed.success).toBe(true);
    expect(schemas.zLocationType.safeParse(12345).success).toBe(false);
  });
});

describe("auth layer", () => {
  it("injects credential + version query params via the fetch wrapper", async () => {
    const seen: string[] = [];
    const fakeFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        seen.push(url);
        return new Response("{}", { status: 200 });
      });

    const wrapped = createYextFetch({
      credential: { type: "apiKey", value: "test-key" },
      version: "20240101",
    });
    await wrapped(new Request("https://api.yextapis.com/v2/accounts/me/entities"));

    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!);
    expect(url.searchParams.get("api_key")).toBe("test-key");
    expect(url.searchParams.get("v")).toBe("20240101");

    fakeFetch.mockRestore();
  });

  it("never overwrites an explicitly provided query param", async () => {
    let capturedUrl = "";
    const fakeFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        capturedUrl = input instanceof Request ? input.url : String(input);
        return new Response("{}", { status: 200 });
      });

    const wrapped = createYextFetch({
      credential: { type: "accessToken", value: "oauth-token" },
    });
    await wrapped(new Request("https://api.yextapis.com/v2/x?v=20990101&access_token=explicit"));

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("v")).toBe("20990101");
    expect(url.searchParams.get("access_token")).toBe("explicit");

    fakeFetch.mockRestore();
  });

  it("uses DEFAULT_API_VERSION when none is supplied", async () => {
    let capturedUrl = "";
    const fakeFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        capturedUrl = input instanceof Request ? input.url : String(input);
        return new Response("{}", { status: 200 });
      });

    const wrapped = createYextFetch({ credential: { type: "apiKey", value: "k" } });
    await wrapped(new Request("https://api.yextapis.com/v2/x"));

    expect(new URL(capturedUrl).searchParams.get("v")).toBe(DEFAULT_API_VERSION);
    fakeFetch.mockRestore();
  });
});

describe("configure helpers", () => {
  it("configureYextClient applies config to a single client", () => {
    const setConfig = vi.spyOn(knowledgeClient, "setConfig");
    configureYextClient(knowledgeClient, {
      credential: { type: "apiKey", value: "k" },
      baseUrl: "https://api-sandbox.yextapis.com/v2",
    });
    expect(setConfig).toHaveBeenCalledOnce();
    const arg = setConfig.mock.calls[0]![0]!;
    expect(arg.baseUrl).toBe("https://api-sandbox.yextapis.com/v2");
    expect(typeof arg.fetch).toBe("function");
    setConfig.mockRestore();
  });

  it("configureYext covers all 11 generated clients", () => {
    expect(Object.keys(yextClients)).toHaveLength(11);
    const spies = Object.values(yextClients).map((c) => vi.spyOn(c, "setConfig"));
    configureYext({ credential: { type: "apiKey", value: "k" } });
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    }
  });
});

describe("OAuth authorize URL", () => {
  it("builds the production authorize URL with Yext's required params", () => {
    const url = new URL(
      buildYextAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://app.example.com/cb",
        scope: "read_entities",
        state: "xyz",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.yext.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("grant_type")).toBe("authorization_code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/cb");
    expect(url.searchParams.get("state")).toBe("xyz");
  });

  it("targets sandbox hosts when environment is sandbox", () => {
    const url = new URL(
      buildYextAuthorizeUrl({ clientId: "c", redirectUri: "https://x/cb", environment: "sandbox" }),
    );
    expect(url.origin + url.pathname).toBe("https://sandbox.yext.com/oauth2/authorize");
  });
});

describe("error handling", () => {
  const warningResult = {
    response: { status: 200, ok: true },
    data: { meta: { uuid: "u1", errors: [{ code: 1, type: "WARNING", message: "best practice" }] }, response: {} },
  };
  const nonFatalResult = {
    response: { status: 207, ok: true },
    data: { meta: { uuid: "u2", errors: [{ code: 2, type: "NON_FATAL_ERROR", message: "item rejected" }] }, response: {} },
  };
  const fatalResult = {
    response: { status: 400, ok: false },
    error: { meta: { uuid: "u3", errors: [{ code: 3, type: "FATAL_ERROR", message: "bad request" }] } },
  };

  it("separates warnings from blocking errors", () => {
    expect(getYextWarnings(warningResult).map((i) => i.message)).toEqual(["best practice"]);
    expect(getYextErrors(warningResult)).toHaveLength(0);
    expect(hasYextErrors(warningResult)).toBe(false);
  });

  it("treats 207 NON_FATAL_ERROR as a blocking error", () => {
    expect(hasYextErrors(nonFatalResult)).toBe(true);
    expect(getYextErrors(nonFatalResult)).toHaveLength(1);
  });

  it("assertYextOk passes warnings through but throws on errors", () => {
    expect(assertYextOk(warningResult)).toBe(warningResult);
    expect(() => assertYextOk(fatalResult)).toThrow(YextApiError);
    try {
      assertYextOk(fatalResult);
    } catch (err) {
      expect(err).toBeInstanceOf(YextApiError);
      const e = err as YextApiError;
      expect(e.status).toBe(400);
      expect(e.uuid).toBe("u3");
      expect(e.issues[0]?.code).toBe(3);
      expect(e.message).toContain("bad request");
    }
  });
});

describe("multi-tenant per-request auth (withYextAuth)", () => {
  it("isolates concurrent calls that use different tokens (no shared singleton)", async () => {
    const seen: string[] = [];
    const fakeFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      await new Promise((r) => setTimeout(r, 10)); // overlap the two in flight
      seen.push(url.searchParams.get("access_token") ?? "");
      return new Response(
        JSON.stringify({ meta: { uuid: "x", errors: [] }, response: { count: 0, entities: [], pageToken: "" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await Promise.all([
      listEntities({ path: { accountId: "me" }, query: {}, ...withYextAuth({ credential: { type: "accessToken", value: "TENANT_A" } }) }),
      listEntities({ path: { accountId: "me" }, query: {}, ...withYextAuth({ credential: { type: "accessToken", value: "TENANT_B" } }) }),
    ]);

    expect(seen.sort()).toEqual(["TENANT_A", "TENANT_B"]);
    fakeFetch.mockRestore();
  });
});

describe("end-to-end through the generated client", () => {
  it("auto-injects credential + version and validates the response", async () => {
    let calledUrl = "";
    const fakeFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        calledUrl = input instanceof Request ? input.url : String(input);
        return new Response(
          JSON.stringify({ meta: { uuid: "x", errors: [] }, response: { count: 0, entities: [], pageToken: "" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

    configureYextClient(knowledgeClient, {
      credential: { type: "accessToken", value: "tok123" },
      version: "20240101",
      baseUrl: "https://api.yextapis.com/v2",
    });

    // No `v` or `access_token` passed by the caller — the auth layer injects them.
    const result = await listEntities({ path: { accountId: "me" }, query: {} });

    const url = new URL(calledUrl);
    expect(url.pathname).toBe("/v2/accounts/me/entities");
    expect(url.searchParams.get("access_token")).toBe("tok123");
    expect(url.searchParams.get("v")).toBe("20240101");
    expect(result.error).toBeUndefined();
    expect(result.data?.response?.count).toBe(0);

    fakeFetch.mockRestore();
  });
});
