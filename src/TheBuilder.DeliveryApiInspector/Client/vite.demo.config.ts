import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Builds the landing page demo: the real API tab with the backoffice modules swapped for the
 * stand-ins in demo/, into the docs site's public folder. `pnpm build:demo`.
 */
const demo = (file: string) => fileURLToPath(new URL(`./demo/${file}`, import.meta.url));

const standIns = (): Plugin => ({
  name: "demo-stand-ins",
  enforce: "pre",
  resolveId(source, importer) {
    // Lit comes from Umbraco's own re-export, bundled in; every other backoffice module is stood in for.
    if (source.startsWith("@umbraco-cms/backoffice/") && source !== "@umbraco-cms/backoffice/external/lit") {
      return demo("umbraco.ts");
    }
    if (source === "./api.js" && importer?.includes("/src/")) {
      return demo("api.ts");
    }
    return null;
  },
});

export default defineConfig({
  plugins: [standIns()],
  build: {
    lib: { entry: demo("demo.ts"), formats: ["es"], fileName: () => "inspector-demo.js" },
    outDir: "../../../apps/docs/public/demo",
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
  },
});
