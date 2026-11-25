"use client";
// The download buttons on the landing page (hero and final band), and the line under the hero's.
import Link from "next/link";
import releasesFile from "../content/releases.json";
import type { Release } from "../lib/downloads";
import { Download } from "./icons";
import { chipName, systemName, useOffer, useReleases } from "./useDownloads";

const BUILT = releasesFile.releases as Release[];

/** One button for this computer. Before a first release, or with no JavaScript, it goes to the Download page. */
export function DownloadButton({ size = "xl" }: { size?: "xl" | "lg" }) {
  const releases = useReleases(BUILT);
  const { offer } = useOffer(releases);
  const cls = `btn btn-primary btn-${size}`;
  if (offer?.kind === "file") return <a className={cls} href={offer.file.url}><Download size="lg" />Download for {systemName(offer.file.platform)}</a>;
  return <Link className={cls} href="/download/"><Download size="lg" />Download</Link>;
}

/** "v2.0.0 · Apple silicon · 118 MB · Windows, Linux and Docker" */
export function ReleaseMeta() {
  const releases = useReleases(BUILT);
  const { offer } = useOffer(releases);
  const v = releases[0]?.version;
  const bits = offer?.kind === "file" ? [`v${v}`, chipName(offer.file.platform), offer.file.size].filter(Boolean).join(" · ") : v ? `v${v}` : "Free and open source, Apache 2.0";
  return <p className="meta">{bits} &nbsp;·&nbsp; <Link href="/download/">Windows, Linux and Docker</Link></p>;
}
