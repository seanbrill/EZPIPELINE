/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";

export default {
  // The site has its own lock file; this stops Next guessing the repository root instead.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  reactStrictMode: true,
  devIndicators: false,
  // Pure static files: no Node at runtime. FileFreak Sites serves them (filefreak sites deploy).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
