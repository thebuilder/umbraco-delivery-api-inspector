// The API tab must show exactly what the Delivery API returns. For every seeded document and media
// item, this asks the sample site's Delivery API and the package's backoffice endpoint the same
// question (draft and published, each culture, with and without expand and fields) and compares
// the two JSON documents. Run the sample first: dotnet run --project samples/TheBuilder.DeliveryApiInspector.Example
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

const site = process.env.SITE_URL ?? "http://localhost:5330";
const apiKey = "example-local-preview-key";
const clientId = "umbraco-back-office-api-inspector-e2e";
const clientSecret = "example-local-e2e-client-secret";

let token;

async function json(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  const body = response.status === 204 ? null : await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

const delivery = (path, { preview = false, culture } = {}) =>
  json(`${site}/umbraco/delivery/api/v2${path}`, {
    ...(preview ? { Preview: "true", "Api-Key": apiKey } : {}),
    ...(culture ? { "Accept-Language": culture } : {}),
  });

const inspector = (path) => json(`${site}/umbraco/delivery-api-inspector/api${path}`, { Authorization: `Bearer ${token}` });

const query = (params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== ""));
  return search.size ? `?${search}` : "";
};

before(async () => {
  const response = await fetch(`${site}/umbraco/management/api/v1/security/back-office/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  assert.equal(response.status, 200, "The sample's API user could not sign in. Is the sample running?");
  token = (await response.json()).access_token;
});

// Every item under a tree, through the Management API rather than the Delivery API's own listing,
// which reads a search index that may still be building when the sample has just seeded.
async function tree(kind) {
  const ids = [];
  const visit = async (path) => {
    const { body } = await json(`${site}/umbraco/management/api/v1/tree/${kind}/${path}`, { Authorization: `Bearer ${token}` });
    for (const item of body.items) {
      ids.push(item.id);
      if (item.hasChildren) await visit(`children?parentId=${item.id}&take=1000`);
    }
  };
  await visit("root?take=1000");
  return ids;
}

const variants = [
  { expand: undefined, fields: undefined },
  { expand: "properties[$all]", fields: undefined },
  { expand: "properties[$all[properties[$all]]]", fields: undefined },
  { expand: undefined, fields: "properties[title]" },
];

describe("documents", () => {
  it("covers the seeded site", async () => {
    const ids = await tree("document");
    assert.ok(ids.length > 50, `Expected the seeded site, found ${ids.length} documents.`);
  });

  it("returns what the Delivery API returns, for every document, culture, version, expand and fields", async (t) => {
    for (const id of await tree("document")) {
      const draft = await delivery(`/content/item/${id}`, { preview: true });
      if (draft.status !== 200) continue; // An item the Delivery API leaves out.
      const document = draft.body;
      const cultures = Object.keys(document.cultures).length > 1 ? Object.keys(document.cultures) : [undefined];
      for (const culture of cultures) {
        for (const preview of [true, false]) {
          await t.test(`${document.route.path} ${culture ?? ""} ${preview ? "draft" : "published"}`, async () => {
          for (const params of variants) {
            const expected = await delivery(`/content/item/${document.id}${query(params)}`, { preview, culture });
            const actual = await inspector(`/content/${document.id}${query({ ...params, preview, culture })}`);
            assert.equal(actual.status, expected.status === 200 ? 200 : 404, `status for ${JSON.stringify(params)}`);
            if (expected.status === 200) {
              assert.deepEqual(actual.body, expected.body, `body for ${JSON.stringify(params)}`);
            }
          }
        });
        }
      }
    }
  });
});

describe("media", () => {
  it("returns what the Delivery API returns, for every media item", async (t) => {
    const ids = await tree("media");
    assert.ok(ids.length > 3, `Expected the seeded media, found ${ids.length}.`);
    for (const id of ids) {
      await t.test(id, async () => {
        const expected = await delivery(`/media/item/${id}`);
        const actual = await inspector(`/media/${id}`);
        assert.equal(actual.status, expected.status);
        assert.deepEqual(actual.body, expected.body);
      });
    }
  });
});

describe("access", () => {
  it("refuses a request without a backoffice token", async () => {
    const response = await fetch(`${site}/umbraco/delivery-api-inspector/api/content/e0000000-0000-0000-0000-000000000001`);
    assert.equal(response.status, 401);
  });

  it("says the Delivery API is set up and the user may use the tab", async () => {
    const { body } = await inspector("/config");
    assert.equal(body.allowed, true);
    assert.equal(body.deliveryApi.installed, true);
    assert.equal(body.deliveryApi.path, "/umbraco/delivery/api/v2");
  });

  it("gives a Settings user each document and media type's key by alias, as the Management API has them", async () => {
    const { body } = await inspector("/config");
    for (const [kind, map] of [["document-type", body.documentTypes], ["media-type", body.mediaTypes]]) {
      const types = {};
      const visit = async (path) => {
        const { body: page } = await json(`${site}/umbraco/management/api/v1/tree/${kind}/${path}`, { Authorization: `Bearer ${token}` });
        for (const item of page.items) {
          if (!item.isFolder) {
            const { body: type } = await json(`${site}/umbraco/management/api/v1/${kind}/${item.id}`, { Authorization: `Bearer ${token}` });
            types[type.alias] = item.id;
          }
          if (item.hasChildren) await visit(`children?parentId=${item.id}&take=1000`);
        }
      };
      await visit("root?take=1000");
      assert.ok(Object.keys(types).length > 0, `The sample has no ${kind}s to compare.`);
      assert.deepEqual(map, types, kind);
    }
  });

  it("answers a malformed expand the way the Delivery API does, with a 400", async () => {
    const { status } = await inspector(`/content/e0000000-0000-0000-0000-000000000001?expand=properties[`);
    assert.equal(status, 400);
  });
});
