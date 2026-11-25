# Releasing

How a version of the desktop app gets to the Download page, and how the public site is
deployed. The installers live on FileFreak, one folder per version; the site and the
installed apps both read that folder.

## What it needs, once

| What | Where it goes |
|---|---|
| The release folder: `releases/` in EZPipeline's FileFreak app, which `publish-release.mjs` makes and makes public (the account's public page must be on). Being public, it is listed with no key, by the site's build, the Download page and the apps. | `EZP_RELEASE_FOLDER` (`0fe590d4-cbd6-4274-b40e-3413eddabab0`), also `RELEASES` in `apps/desktop/electron/release.mjs` and `FOLDER` in `apps/site/scripts/releases-lib.mjs` |
| A **write** key (`files:write`) for EZPipeline's FileFreak app; no read key | `FILEFREAK_KEY` |
| A key made for the app that owns the site, not limited to a folder, allowed `sites:deploy` | `FILEFREAK_SITE_KEY` |
| The site's name, and any custom domain | `EZP_SITE_NAME`. For a domain, add a TXT record `_filefreak.<domain>` and a CNAME to `domains.filefreak.page` |
| Where the self-host image goes on FileFreak's container registry, without a tag | `EZP_IMAGE` (`api.filefreak.io/ezpipeline/ezpipeline`) |
| A key made for the EZPipeline organisation on FileFreak, allowed `containers:write` (a personal key reaches only its own account's images) | `FILEFREAK_IMAGE_KEY` |

## The version

There is one version, in the root `package.json`. The desktop app, its installers'
names (`ezpipeline-<version>-<mac|win|linux>-<arch>.<ext>`) and the release folder's
`v<version>` all use it. Raise it before a release.

## Releasing with the pipeline

`ci/ezpipeline/ezpipeline-release.yaml` is a pipeline for EZPipeline itself. Add it,
set the variables from `ci/ezpipeline/ezpipeline-release.env.example` on it or its
group, and install the FileFreak CLI plugin (Settings, Plugins). Then run it. It:

1. checks the programs, the variables, and that the site key can deploy;
2. clones the repository and runs every package's tests;
3. publishes the installers **only if** `v<version>` is not in the release folder yet,
   so a run never replaces files a Mac uploaded (otherwise it only checks the write key);
4. publishes the container image the self-host wizard deploys, for x86 and Arm, as
   `$EZP_IMAGE:<version>` and `:latest`, unless that version is there already, then checks
   that a visitor with no key can pull it;
5. builds the site, whose Download page lists what is in the folder;
6. deploys it with `filefreak sites deploy out --site $EZP_SITE_NAME`.

On a Linux host, step 3 builds the Windows installer and the Linux AppImages. Only a
Mac makes the macOS app, so `release-check` then warns that the macOS systems have no
file. Publish those from a Mac.

The first time an image is pushed, make it public on FileFreak (Developers, Container
images, the repository, Who can pull it). Until then a new cloud instance cannot pull it,
and the release run and the wizard's Review step both say so.

## Releasing from a Mac

A Mac builds every system:

```bash
cd apps/desktop && npm ci && cd ../..
node apps/desktop/scripts/dist.mjs --all
(cd apps/site && npm ci)
FILEFREAK_KEY=… node scripts/publish-release.mjs
EZP_RELEASE_FOLDER=… node scripts/release-check.mjs --strict
```

`publish-release.mjs` uploads this version's installers to `v<version>`, then
`SHA256SUMS.txt` last. The apps and the site treat a version without that file as
still going up. Uploading a version again replaces its files, so it is safe to repeat.
`--check` only checks the key can write, before a long build.

`release-check.mjs` reads the folder the way the apps do, with no key. It fails if the
version is missing or not public, has no `SHA256SUMS.txt`, or has a file whose SHA-256
is not the one built. With `--strict`, a system with no file fails it too.

## The site on its own

```bash
cd apps/site
npm ci
npm run build      # lists the public release folder, no key; with no folder yet, content/releases.json is kept
FILEFREAK_KEY=<site key> filefreak sites deploy out --site ezpipeline
```

`npm run dev` serves it on port 5195 while you work on it. `npm test` checks platform
detection and the release list.
