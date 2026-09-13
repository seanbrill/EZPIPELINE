/**
 * How long each step of a pipeline usually takes, from the runs already stored.
 *
 * A step is an arbitrary shell command, so there is nothing inside one to
 * measure progress against. What there is, is history: the same step has run
 * before and its duration was recorded. That is enough to turn a bar that only
 * ever showed state into one that moves.
 *
 * Pulled out of EZPipelineController so the rule can be tested without
 * standing up a controller, a database and a pipeline registry.
 */

export interface BuildRow {
    target: string;
    status: string;
    step_timings?: string | null;
}

/** Most recent runs to average over. Enough to be stable, few enough to follow
 *  a pipeline that genuinely got slower. */
export const SAMPLE_SIZE = 10;

/**
 * target -> step name -> median duration in ms.
 *
 * MEDIAN, NOT MEAN. Build durations have a long right tail - a cold image
 * build, a registry that was slow once, a network hiccup - and a single
 * outlier drags an average far enough that every later run looks early. The
 * median ignores it.
 *
 * SUCCESSFUL RUNS ONLY. A step that failed after four seconds is not evidence
 * that it takes four seconds; it is evidence of a failure. Counting those
 * makes the estimate shrink every time something breaks, which is precisely
 * when a truthful estimate is worth having.
 *
 * `rows` is expected newest first, which is how getRecentBuilds returns them:
 * the sample cap then keeps the most recent runs rather than an arbitrary ten.
 */
export function stepEstimates(rows: BuildRow[]): Map<string, Map<string, number>> {
    const samples = new Map<string, Map<string, number[]>>();

    for (const row of rows) {
        if (row.status !== "success") continue;

        let timings: Record<string, unknown>;
        try {
            timings = JSON.parse(row.step_timings || "{}");
        } catch {
            continue;
        }
        if (!timings || typeof timings !== "object") continue;

        let perStep = samples.get(row.target);
        if (!perStep) samples.set(row.target, (perStep = new Map()));

        for (const [name, entry] of Object.entries(timings)) {
            const ms = (entry as { duration?: unknown } | null)?.duration;
            // A ZERO IS NOT A MEASUREMENT. An approval gate records one,
            // because its clock runs while a person is somewhere else, and a
            // zero estimate would send the bar straight to full the instant
            // the gate opened.
            if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;

            const list = perStep.get(name) ?? [];
            if (list.length < SAMPLE_SIZE) {
                list.push(ms);
                perStep.set(name, list);
            }
        }
    }

    const out = new Map<string, Map<string, number>>();
    for (const [target, perStep] of samples) {
        const medians = new Map<string, number>();
        for (const [name, list] of perStep) {
            const sorted = [...list].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            medians.set(
                name,
                sorted.length % 2
                    ? sorted[mid]
                    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
            );
        }
        out.set(target, medians);
    }
    return out;
}
