import path from "path";
import EZPipelineController from "../controllers/EZPipelineController.js";
import { PermissionsService, PermissionType } from "./PermissionsService.js";

/**
 * May this user do `perm` on this pipeline?
 *
 * Grants are stored against a pipeline's id OR its display name (appName), and
 * a route may be handed either. Every route repeated the same three checks to
 * cover that; this is them, once.
 */
// Group grants reach the pipelines filed in the group (PermissionsService.resolveGrant).
PermissionsService.groupOf = (t) => {
  const p = EZPipelineController.instance?.targets.find((x) => x.id === t || x.appName === t);
  return p ? (p.group || null) : null;
};

export function canOnPipeline(userId: number, pipeline: string, perm: PermissionType): boolean {
  const ps = PermissionsService.getInstance();
  if (ps.checkPermission(userId, pipeline, perm)) return true;
  const t = EZPipelineController.instance?.targets.find((x) => x.id === pipeline || x.appName === pipeline);
  if (!t) return false;
  return ps.checkPermission(userId, t.id, perm) || (!!t.appName && ps.checkPermission(userId, t.appName, perm));
}

/**
 * May this user touch this path under the pipelines folder?
 *
 * The path must stay inside the folder. A path inside a pipeline's own folder
 * needs `perm` on that pipeline; any other path needs write on the group it
 * is in (its folder); the root itself needs admin. Returns the resolved
 * absolute path when allowed, null when not.
 */
export function pathAccess(user: { id: number; isAdmin?: boolean }, root: string, rel: string, perm: PermissionType): string | null {
  const base = path.resolve(root);
  const full = path.resolve(base, rel || ".");
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  if (user.isAdmin) return full;
  const t = EZPipelineController.instance?.targets.find((x) => {
    if (!x.filePath) return false;
    const dir = path.dirname(path.resolve(base, x.filePath));
    const r = path.relative(dir, full);
    return !r.startsWith("..") && !path.isAbsolute(r);
  });
  if (t) return canOnPipeline(user.id, t.id, perm) ? full : null;
  const group = path.relative(base, full).split(path.sep).filter(Boolean);
  if (group.length === 0) return null;
  const ps = PermissionsService.getInstance();
  // A grant on any enclosing group covers what is inside it.
  for (let i = group.length; i >= 1; i--) {
    if (ps.checkAccess(user.id, group.slice(0, i).join("/"), perm === "view" ? "read" : "write")) return full;
  }
  return null;
}
