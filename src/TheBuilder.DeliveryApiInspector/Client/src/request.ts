/** The Delivery API request the tab shows: its URL, its headers, and how it shortens on one line. */

export type ItemType = "content" | "media";

export interface RequestOptions {
  type: ItemType;
  id: string;
  preview: boolean;
  culture?: string;
  segment?: string;
  expand?: string;
  fields?: string;
  /** Whether a request for published content needs the API key, because public access is off. */
  publicAccess: boolean;
  hasApiKey: boolean;
}

export interface DeliveryRequest {
  base: string;
  path: string;
  id: string;
  query: string;
  headers: [string, string][];
}

/** The placeholder shown where the API key goes. The tab never has the real key. */
export const API_KEY_PLACEHOLDER = "<your api key>";

export function buildRequest(apiPath: string, options: RequestOptions): DeliveryRequest {
  const params: string[] = [];
  if (options.expand) {
    params.push(`expand=${options.expand}`);
  }
  if (options.fields) {
    params.push(`fields=${options.fields}`);
  }
  const headers: [string, string][] = [];
  if (options.culture) {
    headers.push(["Accept-Language", options.culture]);
  }
  if (options.segment) {
    headers.push(["Accept-Segment", options.segment]);
  }
  if (options.preview) {
    headers.push(["Preview", "true"]);
  }
  if (options.hasApiKey && (options.preview || !options.publicAccess)) {
    headers.push(["Api-Key", API_KEY_PLACEHOLDER]);
  }
  return {
    base: apiPath,
    path: `/${options.type}/item/`,
    id: options.id,
    query: params.length ? `?${params.join("&")}` : "",
    headers,
  };
}

export const fullUrl = (request: DeliveryRequest): string => `${request.base}${request.path}${request.id}${request.query}`;

/** Shortens text in the middle to `length` characters, keeping a little more of the start. */
export function middle(text: string, length: number): string {
  if (text.length <= length) {
    return text;
  }
  const head = Math.ceil((length - 1) * 0.55);
  return `${text.slice(0, head)}…${text.slice(text.length - (length - 1 - head))}`;
}

export interface UrlParts {
  /** Muted: the part that is the same for every request. */
  lead: string;
  id: string;
  query: string;
}

/**
 * The ways to show the URL, longest first. What is the same on every request goes first, then the
 * GUID shortens in the middle, and the query string, the part a developer changes, shortens last.
 */
export function* urlVariants(request: DeliveryRequest): Generator<UrlParts> {
  const { base, path, id, query } = request;
  yield { lead: base + path, id, query };
  yield { lead: `…${path}`, id, query };
  const shortPath = `…/${path.split("/").filter(Boolean).pop()}/`;
  yield { lead: shortPath, id: middle(id, 13), query };
  for (let length = query.length - 1; length >= 12; length -= 3) {
    yield { lead: shortPath, id: middle(id, 13), query: middle(query, length) };
  }
}

/** The first variant that fits, given a function that says whether a variant fits. */
export function fitUrl(request: DeliveryRequest, fits: (parts: UrlParts) => boolean): UrlParts {
  let last: UrlParts | undefined;
  for (const parts of urlVariants(request)) {
    last = parts;
    if (fits(parts)) {
      return parts;
    }
  }
  return last!;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export function toCurl(origin: string, request: DeliveryRequest): string {
  const url = encodeURI(origin + fullUrl(request)).replaceAll("[", "%5B").replaceAll("]", "%5D").replaceAll("$", "%24");
  return [`curl ${shellQuote(url)}`, ...request.headers.map(([name, value]) => `  -H ${shellQuote(`${name}: ${value}`)}`)].join(" \\\n");
}

export function toFetch(origin: string, request: DeliveryRequest): string {
  const url = origin + fullUrl(request);
  if (!request.headers.length) {
    return `const response = await fetch(${JSON.stringify(url)});`;
  }
  const headers = request.headers.map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`).join("\n");
  return `const response = await fetch(${JSON.stringify(url)}, {\n  headers: {\n${headers}\n  },\n});`;
}

/** Builds an expand or fields value from the chosen property aliases. */
export function propertiesParam(aliases: readonly string[]): string {
  return aliases.length ? `properties[${aliases.join(",")}]` : "";
}
