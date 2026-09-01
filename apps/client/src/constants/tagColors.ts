export interface TagColorDef {
    bg: string;
    text: string;
    border: string;
    dot: string;
    name: string;
}

export const TAG_COLORS: Record<string, TagColorDef> = {
    emerald: {
        name: 'Emerald',
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-500',
        border: 'border-emerald-500/20',
        dot: 'bg-emerald-500'
    },
    blue: {
        name: 'Blue',
        bg: 'bg-blue-500/10',
        text: 'text-blue-500',
        border: 'border-blue-500/20',
        dot: 'bg-blue-500'
    },
    amber: {
        name: 'Amber',
        bg: 'bg-amber-500/10',
        text: 'text-amber-500',
        border: 'border-amber-500/20',
        dot: 'bg-amber-500'
    },
    rose: {
        name: 'Rose',
        bg: 'bg-rose-500/10',
        text: 'text-rose-500',
        border: 'border-rose-500/20',
        dot: 'bg-rose-500'
    },
    purple: {
        name: 'Purple',
        bg: 'bg-purple-500/10',
        text: 'text-purple-500',
        border: 'border-purple-500/20',
        dot: 'bg-purple-500'
    },
    indigo: {
        name: 'Indigo',
        bg: 'bg-indigo-500/10',
        text: 'text-indigo-500',
        border: 'border-indigo-500/20',
        dot: 'bg-indigo-500'
    },
    cyan: {
        name: 'Cyan',
        bg: 'bg-cyan-500/10',
        text: 'text-cyan-500',
        border: 'border-cyan-500/20',
        dot: 'bg-cyan-500'
    },
    slate: {
        name: 'Slate',
        bg: 'bg-slate-500/10',
        text: 'text-slate-500',
        border: 'border-slate-500/20',
        dot: 'bg-slate-500'
    },
    orange: {
        name: 'Orange',
        bg: 'bg-orange-500/10',
        text: 'text-orange-500',
        border: 'border-orange-500/20',
        dot: 'bg-orange-500'
    },
    pink: {
        name: 'Pink',
        bg: 'bg-pink-500/10',
        text: 'text-pink-500',
        border: 'border-pink-500/20',
        dot: 'bg-pink-500'
    },
    violet: {
        name: 'Violet',
        bg: 'bg-violet-500/10',
        text: 'text-violet-500',
        border: 'border-violet-500/20',
        dot: 'bg-violet-500'
    },
    lime: {
        name: 'Lime',
        bg: 'bg-lime-500/10',
        text: 'text-lime-500',
        border: 'border-lime-500/20',
        dot: 'bg-lime-500'
    },
    fuchsia: {
        name: 'Fuchsia',
        bg: 'bg-fuchsia-500/10',
        text: 'text-fuchsia-500',
        border: 'border-fuchsia-500/20',
        dot: 'bg-fuchsia-500'
    }
};
