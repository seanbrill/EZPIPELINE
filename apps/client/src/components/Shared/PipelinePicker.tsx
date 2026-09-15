import { useEffect, useMemo, useRef, useState } from "react";
import { EnvTag } from "./EnvTag";
import { ChevronDown, Search, X } from "lucide-react";

/**
 * Pick a pipeline: searchable, grouped, keyboard-driven.
 *
 * WHY NOT A <select>. The Quick Run bar used a native one, which is fine for
 * five options and stops being fine somewhere around twenty. Three specific
 * things break:
 *
 *   - NO SEARCH. A native select on a desktop browser matches only the first
 *     letters you type, and only if you type them fast enough. "deploy-dev"
 *     cannot be found by typing "dev".
 *   - NO GROUPS THAT MEAN ANYTHING. The old list dealt with two pipelines
 *     sharing a name by appending "(group)" to both - which is a workaround
 *     for a flat list, and reads as clutter when there are four of them.
 *     Pipelines are already organised into groups everywhere else in this app.
 *   - NO ROOM TO SAY WHAT A PIPELINE IS. An <option> is a string. A row can
 *     carry the group and the description, which is the difference between
 *     picking confidently and picking the one you ran last time.
 *
 * Everything else is deliberately the same: same value, same onChange, so the
 * page that uses it did not have to change shape.
 */

export interface PickerPipeline {
    id: string;
    appName: string;
    description?: string;
    group?: string;
    /** The pipeline's `environment:` key, shown as the DEV / PROD pill. */
    environment?: string;
}

export function PipelinePicker({
    pipelines,
    value,
    onChange,
    placeholder = "Select a pipeline...",
    className = "",
}: {
    pipelines: PickerPipeline[];
    value: string;
    onChange: (id: string) => void;
    placeholder?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [cursor, setCursor] = useState(0);
    const root = useRef<HTMLDivElement | null>(null);
    const input = useRef<HTMLInputElement | null>(null);

    const selected = pipelines.find(p => p.id === value) ?? null;

    // Matches on the NAME, the GROUP and the DESCRIPTION. Somebody looking for
    // the deploy pipeline may remember the group it lives in rather than what
    // it is called, and a search that only reads one field sends them back to
    // scrolling.
    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return pipelines;
        return pipelines.filter(p =>
            `${p.appName} ${p.group ?? ""} ${p.description ?? ""}`.toLowerCase().includes(q)
        );
    }, [pipelines, query]);

    /** Grouped for display, with ungrouped pipelines last under "General". */
    const grouped = useMemo(() => {
        const byGroup = new Map<string, PickerPipeline[]>();
        for (const p of matches) {
            const key = p.group?.trim() || "General";
            const list = byGroup.get(key) ?? [];
            list.push(p);
            byGroup.set(key, list);
        }
        return [...byGroup.entries()]
            .sort(([a], [b]) => (a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b)))
            .map(([group, items]) => ({
                group,
                items: items.sort((x, y) => x.appName.localeCompare(y.appName)),
            }));
    }, [matches]);

    /** The same rows again, flat, so the arrow keys have one index to move. */
    const flat = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

    useEffect(() => {
        setCursor(0);
    }, [query, open]);

    useEffect(() => {
        if (open) input.current?.focus();
    }, [open]);

    // Close on a click anywhere else. Pointerdown rather than click, so a press
    // that starts outside and ends inside does not leave it open.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", onDown);
        return () => document.removeEventListener("pointerdown", onDown);
    }, [open]);

    const choose = (id: string) => {
        onChange(id);
        setOpen(false);
        setQuery("");
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor(c => Math.min(c + 1, flat.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor(c => Math.max(c - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = flat[cursor];
            if (pick) choose(pick.id);
        } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
        }
    };

    return (
        <div ref={root} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="w-full flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-left text-sm text-white hover:border-slate-600 focus:border-emerald-500 outline-none transition-colors"
            >
                <span className={`flex-1 truncate ${selected ? "" : "text-slate-400"}`}>
                    {selected ? selected.appName : placeholder}
                </span>
                {/* WHICH ENVIRONMENT, in the closed state above all. This
                    control runs things: "notch.fm deploy" reads the same
                    whether it is about to touch development or production, and
                    the group text beside it is easy to skim past. */}
                {selected?.environment && <EnvTag environment={selected.environment} />}
                {/* The group rides along in the closed state too: two pipelines
                    with the same name are otherwise indistinguishable once the
                    list is shut. */}
                {selected?.group && selected.group !== "General" && (
                    <span className="shrink-0 text-[11px] text-slate-400">{selected.group}</span>
                )}
                <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                    <div className="flex items-center gap-2 border-b border-slate-700/70 px-3 py-2">
                        <Search className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <input
                            ref={input}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder="Search pipelines, groups"
                            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery("")}
                                className="shrink-0 text-slate-400 hover:text-white"
                                aria-label="Clear search"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="max-h-72 overflow-y-auto custom-scrollbar py-1">
                        {flat.length === 0 ? (
                            <p className="px-3 py-4 text-center text-xs text-slate-400">
                                {pipelines.length === 0
                                    ? "No pipelines in this group."
                                    : `Nothing matches "${query}".`}
                            </p>
                        ) : (
                            grouped.map(({ group, items }) => (
                                <div key={group}>
                                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                        {group}
                                    </p>
                                    {items.map(p => {
                                        const index = flat.indexOf(p);
                                        const active = index === cursor;
                                        return (
                                            <button
                                                key={p.id}
                                                type="button"
                                                role="option"
                                                aria-selected={p.id === value}
                                                onMouseEnter={() => setCursor(index)}
                                                onClick={() => choose(p.id)}
                                                className={`w-full px-3 py-1.5 text-left transition-colors ${
                                                    active ? "bg-slate-800" : ""
                                                } ${p.id === value ? "text-emerald-400" : "text-white"}`}
                                            >
                                                <span className="flex items-center gap-1.5 min-w-0">
                                                    <span className="truncate text-sm">{p.appName}</span>
                                                    <EnvTag environment={p.environment} />
                                                </span>
                                                {p.description && (
                                                    <span className="block truncate text-[11px] text-slate-400">
                                                        {p.description}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
