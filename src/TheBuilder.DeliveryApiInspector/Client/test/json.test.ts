import { describe, expect, it } from "vitest";
import { diff, formatPath, getAt, guidKind, isImageUrl, parsePath, pathKey, search, type Json } from "../src/json.js";

// A trimmed Delivery API response for a home page, as Umbraco 17 returns it.
const home: Json = {
  contentType: "home",
  name: "Home",
  route: { path: "/", startItem: { id: "cc1e073a-20b7-4f4e-bf52-a24e9c24c620", path: "home" } },
  id: "cc1e073a-20b7-4f4e-bf52-a24e9c24c620",
  properties: {
    title: "Really cool title",
    image: [
      { id: "6d60cc72-dd46-4c36-9b19-b65d2dc4717f", name: "Dark Blue", mediaType: "Image", url: "/media/otgga1kg/dark-blue.jpg", extension: "jpg", width: 900 },
    ],
    file: [{ id: "a1b2c3d4-0000-4000-8000-000000000001", mediaType: "File", url: "/media/x/terms.pdf", extension: "pdf" }],
  },
  cultures: { "en-us": { path: "/" } },
};

describe("paths", () => {
  it("writes the path a frontend developer would type after data", () => {
    expect(formatPath(["properties", "image", 0, "url"])).toBe("properties.image[0].url");
    expect(formatPath(["cultures", "en-us", "path"])).toBe('cultures["en-us"].path');
  });

  it("reads a typed path back, with or without a leading data.", () => {
    expect(parsePath("properties.image[0].url")).toEqual(["properties", "image", 0, "url"]);
    expect(parsePath('data.cultures["en-us"].path')).toEqual(["cultures", "en-us", "path"]);
    expect(parsePath("Really cool")).toBeUndefined();
    expect(parsePath("image]")).toBeUndefined();
  });

  it("finds the value at a path, and nothing past a leaf or a missing key", () => {
    expect(getAt(home, ["properties", "image", 0, "name"])).toBe("Dark Blue");
    expect(getAt(home, ["properties", "title", "length"])).toBeUndefined();
    expect(getAt(home, ["properties", "missing"])).toBeUndefined();
    expect(getAt(home, ["properties", "image", "0"])).toBeUndefined();
  });
});

describe("search", () => {
  it("finds keys and leaf values in document order, and keeps their ancestors open", () => {
    const { hits, keep } = search(home, "url");
    expect(hits.map(formatPath)).toEqual(["properties.image[0].url", "properties.file[0].url"]);
    expect(keep).toEqual(
      new Set([[], ["properties"], ["properties", "image"], ["properties", "image", 0], ["properties", "image", 0, "url"], ["properties", "file"], ["properties", "file", 0], ["properties", "file", 0, "url"]].map(pathKey)),
    );
  });

  it("matches values without regard to case", () => {
    expect(search(home, "DARK").hits.map(formatPath)).toEqual(["properties.image[0].name", "properties.image[0].url"]);
  });

  it("finds nothing for an empty query", () => {
    expect(search(home, "").hits).toEqual([]);
  });
});

describe("diff", () => {
  const published: Json = { name: "Home", updateDate: "2023-11-10T22:01:19", properties: { title: "Old", image: null, tags: ["a", "b"], hidden: true } };
  const draft: Json = { name: "Home", updateDate: "2023-11-10T23:14:28", properties: { title: "New", image: [{ id: "x" }], tags: ["a"], extra: 1 } };

  it("reports added, removed and changed entries by path, with the published value", () => {
    const changes = diff(published, draft);
    expect(Object.fromEntries([...changes].map(([key, change]) => [formatPath(JSON.parse(key)), change]))).toEqual({
      updateDate: { kind: "changed", before: "2023-11-10T22:01:19" },
      "properties.title": { kind: "changed", before: "Old" },
      "properties.image": { kind: "changed", before: null },
      "properties.tags[1]": { kind: "removed", before: "b" },
      "properties.hidden": { kind: "removed", before: true },
      "properties.extra": { kind: "added" },
    });
  });

  it("finds no changes between equal responses", () => {
    expect(diff(home, structuredClone(home)).size).toBe(0);
  });
});

describe("Umbraco-aware rows", () => {
  const props = (home as { properties: { image: Json[]; file: Json[] } }).properties;

  it("knows media ids and document ids from where they sit", () => {
    expect(guidKind(props.image[0], "id", 0)).toBe("media");
    expect(guidKind(home, "id", undefined)).toBe("document");
    expect(guidKind((home as { route: { startItem: Json } }).route.startItem, "id", "startItem")).toBe("document");
    expect(guidKind({ id: "6d60cc72-dd46-4c36-9b19-b65d2dc4717f" }, "id", "picked")).toBeUndefined();
  });

  it("offers thumbnails for image media only", () => {
    expect(isImageUrl(props.image[0], "url", "/media/otgga1kg/dark-blue.jpg")).toBe(true);
    expect(isImageUrl(props.file[0], "url", "/media/x/terms.pdf")).toBe(false);
    expect(isImageUrl({ url: "/media/a.jpg" }, "url", "/media/a.jpg")).toBe(false);
  });
});
