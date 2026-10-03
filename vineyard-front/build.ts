import tailwind from "bun-plugin-tailwind";
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");
await rm(outdir, { recursive: true, force: true });

const entrypoints = [...new Bun.Glob("src/**/*.html").scanSync()];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [tailwind],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

const RUNTIME_FILES = [
  { from: "public/data", to: "data", isOptional: true },
  {
    from: "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
    to: "vendor/maplibre/maplibre-gl-worker.mjs",
    isOptional: false,
  },
  {
    from: "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
    to: "vendor/maplibre/maplibre-gl-shared.mjs",
    isOptional: false,
  },
];
const copiedFiles = RUNTIME_FILES.filter(({ from, isOptional }) => !isOptional || existsSync(path.join(process.cwd(), from)));
for (const { from, to } of copiedFiles) {
  await cp(path.join(process.cwd(), from), path.join(outdir, to), { recursive: true });
}

for (const output of result.outputs) {
  console.log(` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}
console.log(` + ${copiedFiles.map(file => file.to).join(", ")}`);
