/**
 * When a build ran, said so a person can act on it.
 *
 * ── THE PROBLEM WITH A BARE TIME ───────────────────────────────────────────
 *
 * The build row printed `toLocaleTimeString()`, which is fine for a run from
 * this morning and actively misleading for one from last week: "7:34:23 PM"
 * reads as today to everybody, every time. The dashboard keeps build history,
 * so most of what it shows is NOT from today.
 *
 * ── AND WHY NOT "2 DAYS AGO" ───────────────────────────────────────────────
 *
 * Because these timestamps get correlated with Azure logs, container app
 * revisions and Postgres activity, and none of those take a relative phrase.
 * An absolute time is one you can paste into a query; a relative one has to be
 * converted by hand, by somebody who is already debugging something else.
 *
 * So: the time alone when that is unambiguous, and the date in front of it the
 * moment it is not.
 */
export function formatBuildTime(value: string | number | Date | undefined | null): string {
    if (value === undefined || value === null || value === "") return "";
    const d = new Date(value);
    // An unparseable date must not render "Invalid Date" into the row. Saying
    // nothing is the honest answer for a timestamp we cannot read.
    if (Number.isNaN(d.getTime())) return "";

    const now = new Date();
    const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();

    const time = d.toLocaleTimeString();
    if (sameDay) return time;

    // Day and month, not the year: a build list that goes back a year is not a
    // thing this dashboard holds, and the extra four characters cost width in
    // a row that is already tight. Locale-ordered, so it reads correctly
    // wherever it is being read.
    const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return `${date}, ${time}`;
}
