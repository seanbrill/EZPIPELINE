/**
 * How far through a running step we believe we are, 0..1, or null for "no idea".
 *
 * A step is an arbitrary shell command with nothing inside it to measure, so
 * this is elapsed time against the median of previous successful runs. It is
 * an ESTIMATE, and the bar must never claim otherwise:
 *
 * - No history yet returns null, and the caller draws the indeterminate bar it
 *   always had. A made-up number is worse than an honest "still working".
 *
 * - It stops short of full. A bar sitting at 100% while the step is still
 *   running reads as finished-and-stuck, which is the one impression worth
 *   avoiding, and it is the impression the old full-width pulse gave on every
 *   step regardless of how long it had been going.
 *
 * - Past the estimate it keeps creeping, slowly, rather than freezing. A
 *   frozen bar looks like a hung interface; a crawling one looks like a step
 *   taking longer than usual, which is exactly what is happening.
 */
export const AT_ESTIMATE = 0.9;
export const CAP = 0.95;

export function stepProgress(
    estimateMs: number | undefined,
    startedAt: number | undefined,
    now: number
): number | null {
    if (!estimateMs || !startedAt || estimateMs <= 0) return null;

    const elapsed = now - startedAt;
    // A clock skewed the wrong way should read as "just started", not as a
    // negative width that the browser then renders as zero anyway but that
    // anything reading this value would have to defend against.
    if (elapsed <= 0) return 0;

    if (elapsed < estimateMs) return Math.min(AT_ESTIMATE, (elapsed / estimateMs) * AT_ESTIMATE);

    // Overrun. The remaining sliver is spread over the same length again, so a
    // step at twice its usual time is at the cap but has never passed it.
    const over = (elapsed - estimateMs) / estimateMs;
    return Math.min(CAP, AT_ESTIMATE + (CAP - AT_ESTIMATE) * Math.min(1, over));
}
