/**
 * View preferences that survive a refresh, and never break a page.
 *
 * WHAT BELONGS HERE: which group you were looking at, which folders you had
 * open. Per browser, because it is a preference and not data - nothing stored
 * through here is authoritative, and everything read back out should be
 * checked against what actually exists before it is used.
 *
 * WHAT DOES NOT: anything another session needs to see, anything that has to
 * be right. localStorage is per browser, can be cleared without warning, and
 * is unavailable outright in some contexts.
 *
 * Both directions are wrapped. localStorage THROWS in a private window and
 * where site data is blocked, and it can hold something that was valid JSON
 * under an older version of the app and is not now. A remembered tab is not
 * worth taking a dashboard down for, so every failure degrades to the caller's
 * fallback.
 */

export function readJSON<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : (parsed as T);
    } catch {
        return fallback;
    }
}

export function writeJSON(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Blocked, or the quota is full. Neither is worth an exception on
        // every keystroke that changes a filter.
    }
}
