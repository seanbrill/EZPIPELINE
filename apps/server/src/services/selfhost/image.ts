/**
 * Can anybody pull the image a deploy starts from? Asked the way Docker asks, with no
 * key: /v2/ says how to sign in; a registry with public images sends a visitor to its
 * token service; the manifest is then asked for with HEAD, which is not a download.
 */
export type Fetch = typeof fetch;
export interface ImageCheck { ref: string; ok: boolean; reason: string | null }

const ACCEPT = [
  "application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/** host/path/name:tag → its parts. A host is the first part when it has a dot, a colon, or is localhost. */
export function parseRef(ref: string): { host: string; repo: string; tag: string } | null {
  const m = /^([^/]+)\/(.+?)(?::([\w][\w.-]{0,127}))?$/.exec(ref.trim());
  if (!m || !/[.:]|^localhost$/.test(m[1])) return null;
  return { host: m[1], repo: m[2], tag: m[3] ?? "latest" };
}

/** key="value" pairs of a WWW-Authenticate challenge. */
export function challenge(header: string | null): { scheme: string; params: Record<string, string> } | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  const params: Record<string, string> = {};
  for (const m of rest.join(" ").matchAll(/(\w+)="([^"]*)"/g)) params[m[1]] = m[2];
  return { scheme: scheme.toLowerCase(), params };
}

export async function imagePublic(ref: string, f: Fetch = fetch): Promise<ImageCheck> {
  const p = parseRef(ref);
  if (!p) return { ref, ok: false, reason: `${ref} is not an image address (host/name:tag).` };
  const base = `https://${p.host}/v2`;
  const t = AbortSignal.timeout(10_000);
  try {
    const root = await f(`${base}/`, { signal: t });
    let auth: Record<string, string> = {};
    if (root.status === 401) {
      const c = challenge(root.headers.get("www-authenticate"));
      if (!c || c.scheme !== "bearer" || !c.params.realm) {
        return { ref, ok: false, reason: `${p.host} lets nobody pull without a key yet, so a new instance cannot fetch the image on its own.` };
      }
      const u = new URL(c.params.realm);
      if (c.params.service) u.searchParams.set("service", c.params.service);
      u.searchParams.set("scope", `repository:${p.repo}:pull`);
      const tok = await f(u, { signal: t });
      if (!tok.ok) return { ref, ok: false, reason: `${p.host}'s token service refused a visitor (${tok.status}).` };
      const j = (await tok.json()) as { token?: string; access_token?: string };
      auth = { authorization: `Bearer ${j.token ?? j.access_token ?? ""}` };
    }
    const man = await f(`${base}/${p.repo}/manifests/${p.tag}`, { method: "HEAD", headers: { accept: ACCEPT, ...auth }, signal: t });
    if (man.ok) return { ref, ok: true, reason: null };
    if (man.status === 404) return { ref, ok: false, reason: `${ref} is not published, or is not public.` };
    return { ref, ok: false, reason: `${ref} is not public, or has not been pushed yet (${man.status}).` };
  } catch (e) {
    return { ref, ok: false, reason: `${p.host} could not be reached: ${(e as Error).message}` };
  }
}
