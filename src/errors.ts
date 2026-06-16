/**
 * Yext error handling — hand-written, not generated.
 *
 * Yext does NOT signal all problems with HTTP status alone. Every response
 * (success or failure) carries a `meta` envelope, and problems live in
 * `meta.errors[]` — each tagged with a `type`:
 *
 *   - FATAL_ERROR      the whole request was rejected
 *   - NON_FATAL_ERROR  some item/field was rejected, others succeeded (HTTP 207)
 *   - WARNING          accepted, but didn't follow best practices (HTTP 200)
 *
 * So a `WARNING` rides along on a 200, and `NON_FATAL_ERROR`s ride along on a
 * 207 Multi-Status. Checking `response.ok` alone misses both. These helpers
 * read `meta.errors` from the SDK's `{ data, error, response }` result and let
 * you treat warnings and errors correctly.
 *
 * Docs: https://hitchhikers.yext.com/docs/managementapis/introduction/errors
 */
import { z } from "zod";

/** Yext issue severities (the `type` field of each `meta.errors[]` entry). */
export const YEXT_ISSUE_TYPES = ["FATAL_ERROR", "NON_FATAL_ERROR", "WARNING"] as const;
export type YextIssueType = (typeof YEXT_ISSUE_TYPES)[number];

/** A single entry from a Yext response's `meta.errors[]`. */
export const yextIssueSchema = z.object({
  name: z.string().optional(),
  /** Numeric code uniquely identifying the error or warning. */
  code: z.number().optional(),
  type: z.enum(YEXT_ISSUE_TYPES).optional(),
  message: z.string().optional(),
});
export type YextIssue = z.infer<typeof yextIssueSchema>;

/** The Yext `meta` envelope present on every response. */
export const yextMetaSchema = z.object({
  uuid: z.string().optional(),
  errors: z.array(yextIssueSchema).optional(),
});
export type YextMeta = z.infer<typeof yextMetaSchema>;

/** The shape of a generated SDK call result (client-fetch `fields` style). */
export interface YextResultLike {
  data?: unknown;
  error?: unknown;
  response?: { status?: number; ok?: boolean };
}

function metaIssuesOf(body: unknown): YextIssue[] {
  const meta = (body as { meta?: unknown } | null | undefined)?.meta;
  const parsed = yextMetaSchema.safeParse(meta);
  return parsed.success ? (parsed.data.errors ?? []) : [];
}

function metaUuidOf(body: unknown): string | undefined {
  const meta = (body as { meta?: unknown } | null | undefined)?.meta;
  const parsed = yextMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data.uuid : undefined;
}

/** All issues (errors AND warnings) from both the success and error bodies. */
export function getYextIssues(result: YextResultLike): YextIssue[] {
  return [...metaIssuesOf(result.data), ...metaIssuesOf(result.error)];
}

/** Only the blocking issues — FATAL_ERROR and NON_FATAL_ERROR (not warnings). */
export function getYextErrors(result: YextResultLike): YextIssue[] {
  return getYextIssues(result).filter((i) => i.type !== "WARNING");
}

/** Only the WARNING issues (data was still accepted). */
export function getYextWarnings(result: YextResultLike): YextIssue[] {
  return getYextIssues(result).filter((i) => i.type === "WARNING");
}

/**
 * True if the result represents a failure: a >= 400 status, a populated `error`
 * body, or any FATAL_ERROR / NON_FATAL_ERROR issue (e.g. a 207 Multi-Status).
 */
export function hasYextErrors(result: YextResultLike): boolean {
  const status = result.response?.status;
  if (typeof status === "number" && status >= 400) return true;
  if (result.error !== undefined && result.error !== null) return true;
  return getYextErrors(result).length > 0;
}

/** Error thrown by {@link assertYextOk}, carrying the HTTP status and issues. */
export class YextApiError extends Error {
  readonly status?: number;
  readonly uuid?: string;
  readonly issues: YextIssue[];

  constructor(message: string, opts: { status?: number; uuid?: string; issues: YextIssue[] }) {
    super(message);
    this.name = "YextApiError";
    this.status = opts.status;
    this.uuid = opts.uuid;
    this.issues = opts.issues;
  }
}

/**
 * Returns the result unchanged if it succeeded; otherwise throws {@link YextApiError}.
 * Warnings alone never throw. Useful for `const { data } = assertYextOk(await getEntity(...))`.
 */
export function assertYextOk<T extends YextResultLike>(result: T): T {
  if (!hasYextErrors(result)) return result;

  const status = result.response?.status;
  const uuid = metaUuidOf(result.data) ?? metaUuidOf(result.error);
  const issues = getYextErrors(result);
  const summary =
    issues.map((i) => `[${i.type ?? "ERROR"}${i.code != null ? ` ${i.code}` : ""}] ${i.message ?? ""}`.trim()).join("; ") ||
    `request failed${typeof status === "number" ? ` with HTTP ${status}` : ""}`;

  throw new YextApiError(`Yext API error: ${summary}`, { status, uuid, issues });
}
