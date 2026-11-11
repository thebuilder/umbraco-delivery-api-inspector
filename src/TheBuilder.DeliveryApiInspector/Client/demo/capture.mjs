// Captures the demo's responses from the sample site, so the landing page shows the package's real output.
// Run the sample site first (see samples/README.md), then `pnpm demo:capture`.
import { copyFile, mkdir, writeFile } from "node:fs/promises";

const site = process.env.SITE_URL ?? "http://localhost:5330";
// The sample's local-only API user, the same one the end-to-end check signs in with.
const clientId = "umbraco-back-office-api-inspector-e2e";
const clientSecret = "example-local-e2e-client-secret";
// Harbour mornings: an article with a draft change, an image and related articles.
const id = "e0000000-0000-0000-0000-000000000003";

const auth = await fetch(`${site}/umbraco/management/api/v1/security/back-office/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
});
const token = (await auth.json()).access_token;

async function get(path) {
  const response = await fetch(`${site}/umbraco/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response;
}

const responses = {};
for (const preview of [true, false]) {
  for (const expand of ["", "properties[$all]"]) {
    const response = await get(`delivery-api-inspector/api/content/${id}?preview=${preview}${expand ? `&expand=${encodeURIComponent(expand)}` : ""}`);
    const text = await response.text();
    const timing = /build;dur=([\d.]+)/.exec(response.headers.get("Server-Timing") ?? "");
    responses[`${preview ? "draft" : "published"}:${expand ? "all" : "none"}`] = {
      data: JSON.parse(text),
      buildMs: timing ? Math.min(Number(timing[1]), 12) : undefined,
    };
  }
}

// No type links: there is no backoffice on the docs site to open them in.
const config = { ...(await (await get("delivery-api-inspector/api/config")).json()), documentTypes: null, mediaTypes: null };
await writeFile(new URL("./fixtures.json", import.meta.url), `${JSON.stringify({ id, config, responses }, null, 2)}\n`);

// The images the responses point at, for the thumbnails, served by the docs site.
const media = new URL("../../../../apps/docs/public/demo/media/", import.meta.url);
await mkdir(media, { recursive: true });
const urls = new Set(JSON.stringify(responses).match(/\/media\/[^"]+\.(?:png|jpe?g|webp)/g));
for (const url of urls) {
  await copyFile(new URL(`../../../../samples/TheBuilder.DeliveryApiInspector.Example/wwwroot${url}`, import.meta.url), new URL(url.split("/").pop(), media));
}
console.log("Captured the demo's responses into demo/fixtures.json.");
