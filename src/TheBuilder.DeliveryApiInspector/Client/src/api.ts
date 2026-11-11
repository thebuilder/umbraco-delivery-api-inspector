/** The package's backoffice endpoints (ManagementApi/ in the package) and the backoffice's item lookups. */
import type { ItemKind, Json } from "./json.js";

interface ApiConfiguration {
  baseUrl: string;
  credentials: RequestCredentials;
  token?: string | (() => Promise<string | undefined>);
}

let configuration: ApiConfiguration = { baseUrl: "", credentials: "same-origin" };

export const configureApi = (next: ApiConfiguration): void => {
  configuration = next;
};

export const backofficeOrigin = (): string => configuration.baseUrl || window.location.origin;

export interface InspectorConfig {
  allowed: boolean;
  media: boolean;
  /** Document and media type keys by alias, for users who can open Settings; null for others. */
  documentTypes: Record<string, string> | null;
  mediaTypes: Record<string, string> | null;
  deliveryApi: {
    installed: boolean;
    enabled: boolean;
    publicAccess: boolean;
    mediaEnabled: boolean;
    mediaPublicAccess: boolean;
    hasApiKey: boolean;
    path: string;
  };
}

export interface InspectorResponse {
  data: Json;
  /** How long the server took to build the response, in milliseconds. */
  buildMs?: number;
  bytes: number;
}

export class InspectorError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request(path: string, signal?: AbortSignal): Promise<Response> {
  const token = typeof configuration.token === "function" ? await configuration.token() : configuration.token;
  const response = await fetch(`${configuration.baseUrl}/umbraco/${path}`, {
    credentials: configuration.credentials,
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  if (!response.ok) {
    let message = response.statusText || `The request failed (${response.status}).`;
    try {
      const problem = (await response.json()) as { title?: string; detail?: string };
      message = problem.title ?? problem.detail ?? message;
    } catch {
      // Not a problem document; keep the status text.
    }
    throw new InspectorError(message, response.status);
  }
  return response;
}

let config: Promise<InspectorConfig> | undefined;

export const api = {
  /** Fetched once per backoffice session: the settings it reads change only on a restart. */
  config(): Promise<InspectorConfig> {
    config ??= request("delivery-api-inspector/api/config")
      .then((response) => response.json() as Promise<InspectorConfig>)
      .catch((error: unknown) => {
        config = undefined;
        throw error;
      });
    return config;
  },

  /** Whether the current user may use the tab on a document, by permission or a group named in settings. */
  async contentAccess(id: string): Promise<boolean> {
    const response = await request(`delivery-api-inspector/api/access/content/${id}`);
    return ((await response.json()) as { allowed: boolean }).allowed;
  },

  async item(
    type: "content" | "media",
    id: string,
    query: { preview?: boolean; culture?: string; segment?: string; expand?: string; fields?: string },
    signal?: AbortSignal,
  ): Promise<InspectorResponse> {
    const params = new URLSearchParams();
    if (type === "content") {
      params.set("preview", String(query.preview ?? true));
      if (query.culture) params.set("culture", query.culture);
      if (query.segment) params.set("segment", query.segment);
    }
    if (query.expand) params.set("expand", query.expand);
    if (query.fields) params.set("fields", query.fields);
    const response = await request(`delivery-api-inspector/api/${type}/${id}?${params}`, signal);
    const text = await response.text();
    const timing = /build;dur=([\d.]+)/.exec(response.headers.get("Server-Timing") ?? "");
    return { data: JSON.parse(text) as Json, buildMs: timing ? Number(timing[1]) : undefined, bytes: new Blob([text]).size };
  },

  /** Which of the GUIDs are documents and which are media, through the backoffice's own item endpoints. */
  async kinds(ids: string[]): Promise<Map<string, ItemKind>> {
    const kinds = new Map<string, ItemKind>();
    if (!ids.length) {
      return kinds;
    }
    const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    for (const kind of ["document", "media"] as const) {
      try {
        const response = await request(`management/api/v1/item/${kind}?${query}`);
        for (const item of (await response.json()) as { id: string }[]) {
          kinds.set(item.id.toLowerCase(), kind);
        }
      } catch {
        // A section the user cannot open; those GUIDs stay plain text.
      }
    }
    return kinds;
  },
};

const thumbnails = new Map<string, Promise<string | undefined>>();

/**
 * A small version of an image media item, through the backoffice's own resize endpoint, which signs
 * the URL when the site requires signed image URLs (Imaging:HMACSecretKey).
 */
export function thumbnail(id: string, size = 160): Promise<string | undefined> {
  let url = thumbnails.get(id);
  if (!url) {
    url = request(`management/api/v1/imaging/resize/urls?id=${encodeURIComponent(id)}&width=${size}&height=${size}`)
      .then((response) => response.json() as Promise<{ urlInfos: { url: string }[] }[]>)
      .then((items) => items[0]?.urlInfos[0]?.url)
      .catch(() => undefined);
    thumbnails.set(id, url);
  }
  return url;
}

/** Where a document or media item opens in the backoffice. */
export const typeUrl = (kind: "document-type" | "media-type", id: string): string =>
  `${configuration.baseUrl}/umbraco/section/settings/workspace/${kind}/edit/${id}`;

export const editUrl = (kind: ItemKind, id: string): string =>
  `${configuration.baseUrl}/umbraco/section/${kind === "document" ? "content" : "media"}/workspace/${kind}/edit/${id}`;
