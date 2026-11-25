// The site's constants. One GitHub address, used everywhere (design f49).
import pkg from "../package.json";

export const SITE_URL = "https://ezpipeline.filefreak.page";
export const GITHUB = "https://github.com/seanbrill/EZPIPELINE";
export const SITE_NAME = "EZPipeline";
export const VERSION = pkg.version;
export const TAGLINE = "Self-hosted CI/CD. Pipelines in YAML, steps as shell commands, logs live in your browser. Free and open source.";

export const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/docs/", label: "Docs" },
  { href: "/download/", label: "Download" },
];

/** Every static page, for the sitemap. Docs are added from the markdown. */
export const PAGES: { path: string; title: string }[] = [
  { path: "/", title: "Home" },
  { path: "/download/", title: "Download" },
  { path: "/download/install/", title: "Install" },
  { path: "/docs/", title: "Docs" },
];
