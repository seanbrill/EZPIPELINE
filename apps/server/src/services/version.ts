/**
 * EZPipeline's version: the root package.json's, which the desktop app, the installers' names,
 * the release folder's v<version> and the self-host image's tag all use. Kept here as a
 * constant, so a built server knows it without reading files; test/version.test.ts holds it to
 * package.json. EZP_VERSION overrides it (the desktop app passes its own).
 *
 * Not npm_package_version: started with npm, that is the server workspace's own package.json.
 */
export const APP_VERSION = "2.0.0";
export const runningVersion = () => process.env.EZP_VERSION || APP_VERSION;
