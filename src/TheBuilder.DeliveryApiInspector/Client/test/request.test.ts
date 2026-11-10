import { describe, expect, it } from "vitest";
import { buildRequest, fitUrl, propertiesParam, toCurl, toFetch } from "../src/request.js";

const id = "cc1e073a-20b7-4f4e-bf52-a24e9c24c620";
const base = { type: "content" as const, id, publicAccess: true, hasApiKey: true };

describe("the request a frontend would send", () => {
  it("sends the draft with Preview and the API key placeholder", () => {
    const request = buildRequest("/umbraco/delivery/api/v2", { ...base, preview: true, culture: "en-US", expand: "properties[$all]" });
    expect(`${request.base}${request.path}${request.id}${request.query}`).toBe(`/umbraco/delivery/api/v2/content/item/${id}?expand=properties[$all]`);
    expect(request.headers).toEqual([["Accept-Language", "en-US"], ["Preview", "true"], ["Api-Key", "<your api key>"]]);
  });

  it("sends published content without headers when the API is public", () => {
    expect(buildRequest("/umbraco/delivery/api/v2", { ...base, preview: false }).headers).toEqual([]);
  });

  it("sends the API key for published content when public access is off", () => {
    expect(buildRequest("/umbraco/delivery/api/v2", { ...base, preview: false, publicAccess: false }).headers).toEqual([["Api-Key", "<your api key>"]]);
  });

  it("builds expand and fields from property aliases", () => {
    expect(propertiesParam(["image", "author"])).toBe("properties[image,author]");
    expect(propertiesParam([])).toBe("");
  });
});

describe("one-line URL", () => {
  const request = buildRequest("/umbraco/delivery/api/v2", { ...base, preview: false, expand: "properties[$all]", fields: "properties[title,image]" });
  const width = (limit: number) => fitUrl(request, (parts) => (parts.lead + parts.id + parts.query).length <= limit);

  it("shows the whole URL when it fits", () => {
    expect(width(200)).toEqual({ lead: "/umbraco/delivery/api/v2/content/item/", id, query: "?expand=properties[$all]&fields=properties[title,image]" });
  });

  it("drops the fixed base first, then shortens the GUID, and keeps the query whole as long as it can", () => {
    expect(width(110)).toEqual({ lead: "…/content/item/", id, query: "?expand=properties[$all]&fields=properties[title,image]" });
    expect(width(80)).toEqual({ lead: "…/item/", id: "cc1e073…4c620", query: "?expand=properties[$all]&fields=properties[title,image]" });
  });

  it("shortens the query in the middle last", () => {
    const parts = width(50);
    // 50 characters; the step before, with three more of the query, would be 53.
    expect(parts.lead + parts.id + parts.query).toBe("…/item/cc1e073…4c620?expand=properti…[title,image]");
  });
});

describe("copy", () => {
  const request = buildRequest("/umbraco/delivery/api/v2", { ...base, preview: true, expand: "properties[$all]" });

  it("writes a curl command with the brackets encoded and every header", () => {
    expect(toCurl("https://example.com", request)).toBe(
      `curl 'https://example.com/umbraco/delivery/api/v2/content/item/${id}?expand=properties%5B%24all%5D' \\\n  -H 'Preview: true' \\\n  -H 'Api-Key: <your api key>'`,
    );
  });

  it("writes a fetch call", () => {
    expect(toFetch("https://example.com", request)).toBe(
      `const response = await fetch("https://example.com/umbraco/delivery/api/v2/content/item/${id}?expand=properties[$all]", {\n  headers: {\n    "Preview": "true",\n    "Api-Key": "<your api key>",\n  },\n});`,
    );
  });
});
