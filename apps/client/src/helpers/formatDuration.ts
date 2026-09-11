/**
 * How long something took, written the way a person would say it.
 *
 * The dashboard used to print a step's duration as raw seconds with one
 * decimal, so a five minute step read "300.0s" and an hour-long one read
 * "3847.2s". Both are technically the length of time and neither answers the
 * question somebody is asking when they glance at a pipeline, which is "is
 * this the slow one". Nobody carries a mental divide-by-3600.
 *
 * The largest unit leads and smaller ones follow only while they still carry
 * information: 1hr 15min 38s, 15min 38s, 38s. Hours do not print a zero
 * minutes and minutes do not print a zero seconds, because "1hr 0min 0s" is
 * three facts where one will do.
 *
 * Sub-second precision survives only below ten seconds, where it is the
 * difference between a step that ran and a step that did nothing. Above that
 * it is noise on a number nobody reads to a tenth.
 */
export function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "--";

    const totalSeconds = ms / 1000;

    // Under ten seconds, a tenth is the interesting part.
    if (totalSeconds < 10) {
        // A step that truly took no measurable time should say so rather than
        // round to a confident "0.0s".
        if (ms < 50) return "<0.1s";
        return `${totalSeconds.toFixed(1)}s`;
    }

    const whole = Math.round(totalSeconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = whole % 60;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}hr`);
    if (minutes > 0) parts.push(`${minutes}min`);
    // Seconds are dropped only when a larger unit already carries the answer
    // and there is no remainder to report - "2min" rather than "2min 0s".
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(" ");
}
