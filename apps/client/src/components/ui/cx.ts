/** Join class names, dropping anything that is not a non-empty string. */
export function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
