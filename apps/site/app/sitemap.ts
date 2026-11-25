import type { MetadataRoute } from "next";
import { PAGES, SITE_URL } from "../lib/site";
import { allDocs, docPath } from "../lib/docs";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = allDocs().filter((d) => d.slug).map((d) => ({ path: docPath(d) }));
  return [...PAGES, ...docs].map((p) => ({ url: `${SITE_URL}${p.path}` }));
}
