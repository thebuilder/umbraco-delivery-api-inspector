/** Paths, search and diff over a Delivery API response. No DOM, so it is unit tested. */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Segment = string | number;

const identifier = /^[A-Za-z_$][\w$]*$/;

/** A path as a frontend developer writes it after `data`: properties.image[0].url, cultures["en-us"].path. */
export function formatPath(segments: readonly Segment[]): string {
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (identifier.test(segment)) {
      out += out ? `.${segment}` : segment;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}

/** The path's key for maps and sets: unambiguous, unlike the formatted path. */
export const pathKey = (segments: readonly Segment[]): string => JSON.stringify(segments);

/**
 * Reads a typed path back into segments, or undefined when it is not path-shaped. Accepts what
 * formatPath writes and a leading `data.` or `$.`, so a path pasted from code works.
 */
export function parsePath(text: string): Segment[] | undefined {
  let rest = text.trim().replace(/^(data|\$)(?=[.[])/, "").replace(/^\./, "");
  if (!rest) {
    return undefined;
  }
  const segments: Segment[] = [];
  while (rest) {
    let match: RegExpMatchArray | null;
    if ((match = rest.match(/^\[(\d+)\]/))) {
      segments.push(Number(match[1]));
    } else if ((match = rest.match(/^\[("(?:[^"\\]|\\.)*")\]/))) {
      segments.push(JSON.parse(match[1]) as string);
    } else if ((match = rest.match(/^\.?([A-Za-z_$][\w$-]*)/)) && (segments.length === 0 || rest.startsWith("."))) {
      segments.push(match[1]);
    } else {
      return undefined;
    }
    rest = rest.slice(match[0].length);
  }
  return segments;
}

export function getAt(value: Json, segments: readonly Segment[]): Json | undefined {
  let current: Json | undefined = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    if (Array.isArray(current)) {
      if (typeof segment !== "number") {
        return undefined;
      }
      current = current[segment];
    } else {
      if (typeof segment !== "string" || !Object.hasOwn(current, segment)) {
        return undefined;
      }
      current = current[segment];
    }
  }
  return current;
}

export const isContainer = (value: Json | undefined): value is Json[] | { [key: string]: Json } =>
  value !== null && typeof value === "object";

export function children(value: Json[] | { [key: string]: Json }): [Segment, Json][] {
  return Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
}

/** Whether a key or a leaf value contains the query, ignoring case. Containers match on their key only. */
export function matches(key: Segment | null, value: Json, query: string): boolean {
  if (!query) {
    return false;
  }
  const needle = query.toLowerCase();
  if (typeof key === "string" && key.toLowerCase().includes(needle)) {
    return true;
  }
  return !isContainer(value) && String(value).toLowerCase().includes(needle);
}

/**
 * Every path whose key or value matches, in document order, and the set of their ancestors, which
 * is what a filtered tree keeps open.
 */
export function search(root: Json, query: string): { hits: Segment[][]; keep: Set<string> } {
  const hits: Segment[][] = [];
  const keep = new Set<string>();
  const walk = (key: Segment | null, value: Json, path: Segment[]): boolean => {
    let found = key !== null && matches(key, value, query);
    if (found) {
      hits.push(path);
    }
    if (isContainer(value)) {
      for (const [childKey, child] of children(value)) {
        if (walk(childKey, child, [...path, childKey])) {
          found = true;
        }
      }
    }
    if (found) {
      keep.add(pathKey(path));
    }
    return found;
  };
  if (query) {
    walk(null, root, []);
  }
  return { hits, keep };
}

export type ChangeKind = "added" | "removed" | "changed";

export interface Change {
  kind: ChangeKind;
  /** The published value, for removed and changed entries. */
  before?: Json;
}

/**
 * What changed from `before` (published) to `after` (draft), by path. A value whose type changes,
 * or any leaf that differs, is one change; containers of the same type are compared entry by entry.
 */
export function diff(before: Json, after: Json): Map<string, Change> {
  const changes = new Map<string, Change>();
  const walk = (a: Json, b: Json, path: Segment[]) => {
    const sameShape = isContainer(a) && isContainer(b) && Array.isArray(a) === Array.isArray(b);
    if (!sameShape) {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changes.set(pathKey(path), { kind: "changed", before: a });
      }
      return;
    }
    const left = new Map(children(a));
    const right = new Map(children(b));
    for (const [key, value] of left) {
      if (!right.has(key)) {
        changes.set(pathKey([...path, key]), { kind: "removed", before: value });
      }
    }
    for (const [key, value] of right) {
      if (!left.has(key)) {
        changes.set(pathKey([...path, key]), { kind: "added" });
      } else {
        walk(left.get(key)!, value, [...path, key]);
      }
    }
  };
  walk(before, after, []);
  return changes;
}

/** The paths under which something changed, so the Changes view can open exactly those. */
export function changedAncestors(changes: Map<string, Change>): Set<string> {
  const open = new Set<string>();
  for (const key of changes.keys()) {
    const path = JSON.parse(key) as Segment[];
    for (let length = 0; length < path.length; length++) {
      open.add(pathKey(path.slice(0, length)));
    }
  }
  return open;
}

export const isGuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type ItemKind = "document" | "media";

/**
 * What a GUID in a Delivery API response points at, read from where it sits: the `id` of an object
 * with a `mediaType` is media, the `id` of one with a `contentType` and a `route` (or of a
 * `startItem`) is a document. Undefined when the shape does not say.
 */
export function guidKind(parent: Json | undefined, key: Segment, parentKey: Segment | undefined): ItemKind | undefined {
  if (key !== "id" || !isContainer(parent) || Array.isArray(parent)) {
    return undefined;
  }
  if ("mediaType" in parent) {
    return "media";
  }
  if (("contentType" in parent && "route" in parent) || parentKey === "startItem") {
    return "document";
  }
  return undefined;
}

const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "tif", "tiff"]);

/** Whether `url` in this object is an image the backoffice can show a thumbnail of. */
export function isImageUrl(parent: Json | undefined, key: Segment, value: Json): value is string {
  if (key !== "url" || typeof value !== "string" || !isContainer(parent) || Array.isArray(parent) || !("mediaType" in parent)) {
    return false;
  }
  const extension = typeof parent.extension === "string" ? parent.extension : value.split("?")[0].split(".").pop();
  return !!extension && imageExtensions.has(extension.toLowerCase());
}
