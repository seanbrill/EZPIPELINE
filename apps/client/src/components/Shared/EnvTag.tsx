/**
 * The environment pill.
 *
 * ── THE ENVIRONMENT IS WHATEVER THE PIPELINE SAYS IT IS ────────────────────
 *
 * Nothing here knows about "dev" or "prod". The value is the pipeline's own
 * `environment:` key - staging, qa, uat, sandbox, a customer's name - and the
 * colour and label are looked up in preferences, which are editable in
 * Settings. An environment nobody has configured still renders, in the default
 * colour with its own first few characters, because a tag that silently
 * disappears for an unrecognised value is worse than one that is merely plain.
 *
 * ── WHY IT IS A COMPONENT ──────────────────────────────────────────────────
 *
 * It began as fifteen lines inline in FileTreeSidebar, which is why it only
 * ever appeared in the sidebar: the colour lookup, the label lookup and the
 * fallbacks all lived inside one render. Sean asked for the same tag on the
 * Quick Run picker and on the build cards, and the honest way to do that is
 * one definition rather than three that drift.
 *
 * Both maps come from preferences and are editable in Settings, so a tag
 * renamed there has to change everywhere at once - which is an argument for
 * one component rather than three copies of the same lookup.
 */
import { usePreferences } from "../../contexts/PreferencesContext";
import { TAG_COLORS } from "../../constants/tagColors";

export function EnvTag({
    environment,
    className = "",
}: {
    /** The raw value from the pipeline's `environment:` key. */
    environment?: string | null;
    className?: string;
}) {
    const { envTagColors, envTagLabels } = usePreferences();
    if (!environment) return null;

    const key = environment.toLowerCase();
    // The default colour when nobody has configured one for this environment.
    // NOT a guess at which environment it resembles: colouring an unknown
    // value like a known one is how "sandbox" ends up looking like production.
    const style = TAG_COLORS[envTagColors?.[key] ?? ""] ?? TAG_COLORS["emerald"];
    if (!style) return null;

    // The first four characters when there is no configured label, which is
    // what the sidebar has always done - "staging" reads better clipped than
    // wrapped.
    const label = envTagLabels?.[key] || environment.substring(0, 4);

    return (
        <span
            className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text} ${style.border} border whitespace-nowrap ${className}`}
        >
            {label}
        </span>
    );
}
