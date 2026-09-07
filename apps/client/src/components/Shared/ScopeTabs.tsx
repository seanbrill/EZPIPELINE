import React from 'react';
import { Globe, FolderTree } from 'lucide-react';

export const GLOBAL_SCOPE = '__global__';

interface Props {
    scope: string;
    groups: string[];
    onChange: (scope: string) => void;
    /** Shown when no groups exist yet, so the row is never a bare button. */
    emptyHint?: string;
}

/**
 * Instance-wide, or one group.
 *
 * The choice matters more than it looks: every notch.fm pipeline needs the
 * same Azure subscription and every FileFreak pipeline needs a different one.
 * Instance-wide means the two projects share credentials they have no business
 * sharing, and per-pipeline means copies that drift - and the copy that drifts
 * is always the one nobody is looking at.
 */
const ScopeTabs: React.FC<Props> = ({ scope, groups, onChange, emptyHint }) => {
    const base = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 border';
    const on = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    const off = 'text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600';

    return (
        <div className="flex flex-wrap items-center gap-2">
            <button
                type="button"
                onClick={() => onChange(GLOBAL_SCOPE)}
                className={`${base} ${scope === GLOBAL_SCOPE ? on : off}`}
            >
                <Globe className="w-3.5 h-3.5" />
                All pipelines
            </button>

            {groups.map(g => (
                <button
                    key={g}
                    type="button"
                    onClick={() => onChange(g)}
                    className={`${base} ${scope === g ? on : off}`}
                    title={`Applies to every pipeline in ${g}`}
                >
                    <FolderTree className="w-3.5 h-3.5" />
                    {g}
                </button>
            ))}

            {groups.length === 0 && emptyHint && (
                <span className="text-xs text-slate-500 italic ml-1">{emptyHint}</span>
            )}
        </div>
    );
};

export default ScopeTabs;
