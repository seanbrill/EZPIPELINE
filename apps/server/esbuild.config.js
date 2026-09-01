import * as esbuild from "esbuild";
esbuild
  .build({
    entryPoints: ["./compile/src/server.js"],
    bundle: true,
    outfile: "./compile/index.js",
    platform: "node",
    format: "esm",
    external: [""],
    minify: true,
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
  })
  .catch(() => process.exit(1));
