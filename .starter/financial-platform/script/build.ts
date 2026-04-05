import * as esbuild from "esbuild";
import { execSync } from "child_process";

async function build() {
  console.log("Building frontend...");
  execSync("npx vite build", { stdio: "inherit" });

  console.log("Building backend...");
  await esbuild.build({
    entryPoints: ["server/index.ts"],
    outfile: "dist/index.cjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    external: ["pg-native"],
    loader: { ".node": "copy" },
  });

  console.log("Build complete.");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
