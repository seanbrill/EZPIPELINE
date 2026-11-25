// Where releases come from: the public "releases" folder in EZPipeline's FileFreak app, which
// scripts/publish-release.mjs makes and fills. If it cannot be read, the app asks the site's
// /releases.json; if neither answers, a check says it could not check, and nothing else happens.
//
// EZP_UPDATE_URL points a copy at another releases.json, to try an update by hand.
export const SITE = "https://ezpipeline.filefreak.page";
export const DOWNLOADS = `${SITE}/download/`;
/** Where FileFreak answers for public files. */
export const FILES = "https://filefreak.link";
/** The public release folder on FileFreak: one v<version> folder per release. Same as FOLDER in apps/site/scripts/releases-lib.mjs. */
export const RELEASES = "0fe590d4-cbd6-4274-b40e-3413eddabab0";
