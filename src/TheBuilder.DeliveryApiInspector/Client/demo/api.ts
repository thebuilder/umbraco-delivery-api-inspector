/**
 * The demo's stand-in for src/api.ts: answers from responses captured from the sample site
 * (demo/fixtures.json), and applies expand and fields the way the Delivery API does.
 */
import type { ItemKind, Json } from "../src/json.js";
import fixtures from "./fixtures.json";
import type { InspectorConfig, InspectorResponse } from "../src/api.js";

export type { InspectorConfig, InspectorResponse };

export class InspectorError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const configureApi = (): void => {};

/** The origin curl and fetch are copied with. */
export const backofficeOrigin = (): string => "https://example.com";

type Responses = Record<string, { data: Record<string, Json> & { properties: Record<string, Json> }; buildMs?: number }>;
const responses = fixtures.responses as unknown as Responses;

/** The aliases in a properties[a,b] value, or every alias for $all. */
function aliases(param: string | undefined, all: string[]): string[] | undefined {
  const match = /^properties\[(.*)\]$/.exec(param ?? "");
  if (!match) return undefined;
  return match[1] === "$all" ? all : match[1].split(",");
}

export const api = {
  config: (): Promise<InspectorConfig> => Promise.resolve(fixtures.config as InspectorConfig),

  async item(
    _type: "content" | "media",
    _id: string,
    query: { preview?: boolean; expand?: string; fields?: string },
  ): Promise<InspectorResponse> {
    const mode = query.preview === false ? "published" : "draft";
    const shallow = responses[`${mode}:none`];
    const deep = responses[`${mode}:all`];
    const all = Object.keys(shallow.data.properties);
    const expanded = new Set(aliases(query.expand, all) ?? []);
    const fields = aliases(query.fields, all);
    const properties: Record<string, Json> = {};
    for (const alias of fields ?? all) {
      if (alias in shallow.data.properties) {
        properties[alias] = (expanded.has(alias) ? deep : shallow).data.properties[alias];
      }
    }
    const data = { ...shallow.data, properties } as Json;
    const text = JSON.stringify(data);
    // A moment's wait, like a real request, so switching shows the tab's loading state.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { data, buildMs: shallow.buildMs, bytes: new Blob([text]).size };
  },

  /** GUIDs stay plain text: there is no backoffice here to open them in. */
  kinds: (): Promise<Map<string, ItemKind>> => Promise.resolve(new Map()),
};

/** Media URLs in the captured responses, by media item, served from the docs site. */
const media = new Map<string, string>();
(function collect(value: unknown): void {
  if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (typeof item.id === "string" && typeof item.url === "string" && typeof item.mediaType === "string") {
      media.set(item.id, `/demo/media/${item.url.split("/").pop()}`);
    }
    Object.values(item).forEach(collect);
  }
})(fixtures.responses);

export const thumbnail = (id: string): Promise<string | undefined> => Promise.resolve(media.get(id));

export const typeUrl = (): string => "#";
export const editUrl = (): string => "#";
