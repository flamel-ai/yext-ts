/**
 * Yext authentication — hand-written, not generated.
 *
 * Yext accepts three credential shapes (see the `api_key` / `api-key` security
 * schemes in every spec, plus the OAuth `access_token` convention):
 *
 *   - API key in the `api_key` **query** parameter        -> { type: "apiKey" }
 *   - API key in the `api-key` **header**                 -> { type: "apiKeyHeader" }
 *   - OAuth bearer token in the `access_token` **query**  -> { type: "accessToken" }
 *
 * Every Yext request ALSO requires a `v` query parameter — an API version date
 * in `YYYYMMDD` form. We inject both the credential and `v` via a fetch wrapper
 * on the generated client, so auth is applied uniformly to every operation
 * regardless of how an individual spec models security.
 *
 * Typical usage:
 *
 *   import { configureYext } from "@flamel-ai/yext-ts";
 *   configureYext({ credential: { type: "apiKey", value: process.env.YEXT_API_KEY! }, version: "20250401" });
 *
 *   import { getEntity } from "@flamel-ai/yext-ts/knowledge";
 *   const { data } = await getEntity({ path: { entityId: "my-location" } });
 *
 * Or configure a single API's client:
 *
 *   import { client } from "@flamel-ai/yext-ts/knowledge";
 *   import { configureYextClient } from "@flamel-ai/yext-ts";
 *   configureYextClient(client, { credential: { type: "accessToken", value: token } });
 */
import { z } from "zod";

/**
 * Minimal structural shape of a generated client's configuration. Each Yext API
 * module bundles its own fetch client; rather than couple this file to any one
 * module's generated `Client` type, we accept anything with a compatible
 * `setConfig`. The bundled clients satisfy this structurally.
 */
export interface YextClientConfig {
  baseUrl?: string;
  fetch?: (request: Request) => ReturnType<typeof fetch>;
}

/**
 * Anything configurable like a generated client (has `setConfig`). The param is
 * intentionally `any` so every module's bundled `Client` type — whose
 * `setConfig` takes its own full generated `Config` — is structurally
 * assignable without coupling this file to a specific module's types. We pass a
 * strongly-typed {@link YextClientConfig} in practice.
 */
export interface YextConfigurableClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setConfig: (config: any) => unknown;
}

/** Production vs. sandbox Yext environment. */
export type YextEnvironment = "production" | "sandbox";

/**
 * Default API version (`v`) sent when a request doesn't already specify one.
 * Yext pins behavior to this date — set your own to lock the contract you
 * tested against rather than silently tracking the latest.
 */
export const DEFAULT_API_VERSION = "20250401";

/** OAuth browser-authorize endpoints (start of the authorization-code flow). */
export const YEXT_OAUTH_AUTHORIZE_URL: Record<YextEnvironment, string> = {
  production: "https://www.yext.com/oauth2/authorize",
  sandbox: "https://sandbox.yext.com/oauth2/authorize",
};

/** OAuth token endpoints (exchange a code or refresh token for an access token). */
export const YEXT_OAUTH_TOKEN_URL: Record<YextEnvironment, string> = {
  production: "https://api.yext.com/oauth2/accesstoken",
  sandbox: "https://api-sandbox.yext.com/oauth2/accesstoken",
};

/** A Yext credential and where it should be placed on the request. */
export type YextCredential =
  /** Static API key, sent as the `api_key` query parameter. */
  | { type: "apiKey"; value: string }
  /** Static API key, sent as the `api-key` request header. */
  | { type: "apiKeyHeader"; value: string }
  /** OAuth bearer token, sent as the `access_token` query parameter. */
  | { type: "accessToken"; value: string };

export interface YextAuthOptions {
  /** The credential to attach to every request. */
  credential: YextCredential;
  /** API version date (`v` query param). Defaults to {@link DEFAULT_API_VERSION}. */
  version?: string;
  /**
   * Override the base URL the client targets (e.g. to point a CDN-backed API at
   * a sandbox host). When omitted, the base URL baked into the generated client
   * from the OpenAPI spec is kept as-is.
   */
  baseUrl?: string;
}

/**
 * Builds a `fetch` wrapper that injects the Yext credential and `v` version
 * parameter onto every outgoing request. Existing values are never overwritten,
 * so per-call overrides still win.
 */
export function createYextFetch(options: YextAuthOptions): typeof fetch {
  const version = options.version ?? DEFAULT_API_VERSION;
  const { credential } = options;

  // Typed as the full `fetch` signature so it's assignable both at the client
  // config level (`setConfig({ fetch })`) and the per-call level
  // (`Options.fetch`). The generated client always invokes it with a `Request`;
  // the string/URL branch keeps it a valid drop-in `fetch`.
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (!url.searchParams.has("v")) {
      url.searchParams.set("v", version);
    }
    if (credential.type === "apiKey" && !url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", credential.value);
    }
    if (credential.type === "accessToken" && !url.searchParams.has("access_token")) {
      url.searchParams.set("access_token", credential.value);
    }

    const next = new Request(url.toString(), request);
    if (credential.type === "apiKeyHeader" && !next.headers.has("api-key")) {
      next.headers.set("api-key", credential.value);
    }
    return fetch(next);
  };
}

/**
 * Configures a single generated client with Yext auth. Merges over the client's
 * existing config, so the spec's base URL is preserved unless `baseUrl` is set.
 */
export function configureYextClient(
  client: YextConfigurableClient,
  options: YextAuthOptions,
): void {
  client.setConfig({
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    fetch: createYextFetch(options),
  });
}

/**
 * Per-request auth for multi-tenant servers (the Flamel case).
 *
 * Returns call-option overrides to spread into a single SDK call, so each
 * request uses its own credential with NO shared mutable state — safe under
 * concurrency where every request may carry a different token. Prefer this over
 * `configureYext`/`configureYextClient` (which mutate a shared singleton client
 * and are only appropriate for single-tenant apps).
 *
 *   await getEntity({
 *     path: { accountId: "me", entityId: id },
 *     query: {},
 *     ...withYextAuth({ credential: { type: "accessToken", value: req.workspaceToken } }),
 *   });
 */
export function withYextAuth(options: YextAuthOptions): {
  fetch: typeof fetch;
  baseUrl?: string;
} {
  return {
    fetch: createYextFetch(options),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  };
}

/** Schema for the OAuth token endpoint response. */
export const yextOAuthTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export type YextOAuthToken = z.infer<typeof yextOAuthTokenSchema>;

/**
 * Builds the URL to send a user to so they can authorize your app (the start of
 * the OAuth authorization-code flow). After the user approves, Yext redirects
 * to `redirectUri` with a `?code=...` you exchange via {@link requestYextOAuthToken}.
 */
export function buildYextAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  environment?: YextEnvironment;
}): string {
  const url = new URL(YEXT_OAUTH_AUTHORIZE_URL[params.environment ?? "production"]);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  // Yext documents `grant_type` as required on the authorize endpoint too.
  url.searchParams.set("grant_type", "authorization_code");
  if (params.scope) url.searchParams.set("scope", params.scope);
  if (params.state) url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * Exchanges an authorization code (or refresh token) for a Yext OAuth access
 * token. Pass `code` for the authorization-code grant, or `refreshToken` to
 * refresh. The response is validated with {@link yextOAuthTokenSchema}.
 */
export async function requestYextOAuthToken(params: {
  clientId: string;
  clientSecret: string;
  code?: string;
  refreshToken?: string;
  redirectUri?: string;
  environment?: YextEnvironment;
}): Promise<YextOAuthToken> {
  if (!params.code && !params.refreshToken) {
    throw new Error("requestYextOAuthToken: provide either `code` or `refreshToken`.");
  }

  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: params.refreshToken ? "refresh_token" : "authorization_code",
  });
  if (params.code) body.set("code", params.code);
  if (params.refreshToken) body.set("refresh_token", params.refreshToken);
  if (params.redirectUri) body.set("redirect_uri", params.redirectUri);

  const res = await fetch(YEXT_OAUTH_TOKEN_URL[params.environment ?? "production"], {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Yext OAuth token request failed: ${res.status} ${res.statusText} — ${await res.text()}`,
    );
  }
  return yextOAuthTokenSchema.parse(await res.json());
}
