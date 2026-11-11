// Takes the documentation's backoffice screenshots from a running sample site, so they can be
// retaken whenever the UI changes. Start the sample first:
//
//   dotnet run --project samples/TheBuilder.DeliveryApiInspector.Example
//
// then run `pnpm docs:screenshots` (or set UMBRACO_URL for a sample on another address). The script
// signs in with the sample's own unattended login and writes the images to content/screenshots/, and
// the two the landing page shows to public/screenshots/ as well.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const umbracoUrl = (process.env.UMBRACO_URL ?? "http://localhost:5330").replace(/\/$/, "");
const docsRoot = fileURLToPath(new URL("../", import.meta.url));
const sampleSettings = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../samples/TheBuilder.DeliveryApiInspector.Example/appsettings.json", import.meta.url)),
    "utf8",
  ),
);
const login = sampleSettings.Umbraco.CMS.Unattended;

// From the sample's seed (samples/README.md).
const home = "e0000000-0000-0000-0000-000000000001";
const harbourMornings = "e0000000-0000-0000-0000-000000000003";
const harbourImage = "e1000000-0000-0000-0000-000000000002";

const contentDir = `${docsRoot}content/screenshots`;
const publicDir = `${docsRoot}public/screenshots`;
mkdirSync(contentDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

// CHROMIUM_PATH points at a Chromium of your own when Playwright's download is not installed.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto(`${umbracoUrl}/umbraco`);
await page.getByLabel(/email/i).first().fill(login.UnattendedUserEmail);
await page.getByLabel(/password/i).first().fill(login.UnattendedUserPassword);
await page.keyboard.press("Enter");
await page.waitForURL(/\/umbraco\/section\//, { timeout: 30_000 });

const view = page.locator("thebuilder-delivery-api-inspector-view");
const tree = view.locator("thebuilder-json-tree");

async function open(id, kind = "document") {
  const section = kind === "document" ? "content" : "media";
  if (kind === "document") {
    await page.goto(`${umbracoUrl}/umbraco/section/${section}/workspace/${kind}/edit/${id}/invariant/view/api`);
  } else {
    // The media workspace does not open a view from its URL, so click the tab.
    await page.goto(`${umbracoUrl}/umbraco/section/${section}/workspace/${kind}/edit/${id}`);
    await page.getByRole("tab", { name: /API/ }).click();
  }
  await tree.locator(".row").first().waitFor();
  await page.waitForTimeout(500);
}

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${contentDir}/${name}.png` });
}

await open(home);
await view.getByRole("button", { name: "2", exact: true }).click();
await shot("document");

await view.locator('[popovertarget="expand-menu"]').click();
await view.getByRole("menuitemcheckbox", { name: "All" }).click();
await view.locator("input.search").fill("url");
await shot("search");
await view.locator("input.search").fill("");

await open(harbourMornings);
await view.getByRole("button", { name: /Changes/ }).click();
await shot("changes");

await view.getByRole("button", { name: "Draft" }).click();

await open(harbourImage, "media");
await tree.locator(".row", { hasText: '"url"' }).first().hover();
await page.locator("img.thumb, thebuilder-json-tree >> img.thumb").first().waitFor({ state: "visible" }).catch(() => {});
await shot("media");

// The permission in the Administrators group's default document permissions.
await page.goto(`${umbracoUrl}/umbraco/section/user-management/workspace/user-group/edit/e5e7f6c8-7f9c-4b5b-8d5d-9e1e5a4f7e4d`);
const permission = page.getByText("View Delivery API output").first();
await permission.waitFor();
await permission.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const box = await permission.boundingBox();
await page.screenshot({ path: `${contentDir}/user-group-permission.png`, clip: { x: box.x - 110, y: box.y - 130, width: 720, height: 220 } });

await browser.close();

for (const name of ["document", "changes"]) {
  copyFileSync(`${contentDir}/${name}.png`, `${publicDir}/${name}.png`);
}
console.log(`Wrote the screenshots to ${contentDir}.`);
