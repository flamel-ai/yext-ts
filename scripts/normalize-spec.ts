/**
 * Normalizes upstream Yext OpenAPI quirks before code generation.
 *
 * Several Yext specs encode `default` values with the wrong JSON type (e.g. a
 * string `"10"` on an integer query param, `"false"` on a boolean, `"*"` on an
 * array) and mark query-array parameters with `style: "simple"` (which is only
 * valid for path/header params). @hey-api/openapi-ts faithfully reproduces all
 * of these, which then fails our strict typecheck (`z.number().default("10")`,
 * a `style: "simple"` query serializer, etc.).
 *
 * We fix the root cause — the spec — rather than patching generated output, so
 * the generated SDK, zod schemas, and types all come out correct and the
 * vendored `specs/` stay as the untouched upstream copies.
 */

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksNumeric(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

/** Coerces a schema/parameter-schema node's `default` to match its `type`. */
function coerceDefault(node: Record<string, Json>): void {
  if (!("default" in node) || !("type" in node)) return;
  const type = node.type;
  const def = node.default;

  if ((type === "integer" || type === "number") && typeof def === "string" && looksNumeric(def)) {
    node.default = Number(def);
  } else if (type === "boolean" && typeof def === "string") {
    if (def === "true") node.default = true;
    else if (def === "false") node.default = false;
  } else if (type === "array" && def !== undefined && !Array.isArray(def)) {
    node.default = [def];
  }
}

/** Recursively walks any JSON value, applying the fixes in place. */
function walk(value: Json): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  if (!isObject(value)) return;

  coerceDefault(value);

  // Query parameters can't use `style: "simple"` — the valid comma-joined query
  // style is `form` with `explode: false`, which is what these params intend.
  if (value.in === "query" && value.style === "simple") {
    value.style = "form";
  }

  for (const child of Object.values(value)) walk(child);
}

/** Returns a normalized deep copy of an OpenAPI document. */
export function normalizeSpec(spec: Json): Json {
  const copy = structuredClone(spec);
  walk(copy);
  return copy;
}
