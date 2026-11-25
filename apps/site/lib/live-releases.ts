// The release list as the release folder has it now, read in the visitor's browser. The page
// is built with the list as it was then (scripts/fetch-releases.mjs, which reads the folder the
// same way), and shows that first; this brings it up to date, so a version or a .dmg that went
// up since is there without a site build. The folder is public: FileFreak answers anyone, with
// no key. The desktop app reads the same folder to update itself
// (apps/desktop/electron/update.mjs), and checks a download against SHA256SUMS.txt there.

import { FILES, FOLDER as RELEASE_FOLDER, readReleases } from "../scripts/releases-lib.mjs";
import type { Release } from "./downloads";

export { FILES };
/** Null until the public release folder exists (docs/RELEASING.md): the page then shows the list it was built with. */
export const FOLDER: string | null = RELEASE_FOLDER;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The releases, newest first, as the folder has them now; one or two small requests a visit. */
export async function liveReleases(fetch: Fetch, known: Release[], folder = FOLDER): Promise<Release[]> {
  if (!folder) return known;
  return (await readReleases(fetch, known, folder)) as Release[];
}
