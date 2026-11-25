// The releases, newest first, as the Download page was built with them. The desktop app
// reads the release folder itself (apps/desktop/electron/update.mjs), and this when it cannot.
import releases from "../../content/releases.json";

export const dynamic = "force-static";

export function GET() {
  return Response.json({ releases: releases.releases });
}
