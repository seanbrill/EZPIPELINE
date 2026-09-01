import React, { useState, useEffect } from 'react';
import { Eye, Code } from 'lucide-react';
import EnvManager from '../Shared/EnvManager';

interface EnvironmentTabProps {
    content: string;
    onChange: (newContent: string) => void;
    globalVars?: string[];
}

interface ParsedEnvVar {
    key: string;
    value: string;
    quote?: string;
    comment?: string;
}

const EnvironmentTab: React.FC<EnvironmentTabProps> = ({ content, onChange, globalVars = [] }) => {
    const [mode, setMode] = useState<'form' | 'code'>('form');
    const [parsedVars, setParsedVars] = useState<ParsedEnvVar[]>([]);

    // Parse env content to structured data
    useEffect(() => {
        const lines = content.split('\n');
        const vars: ParsedEnvVar[] = [];

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;

            const idx = trimmed.indexOf('=');
            if (idx !== -1) {
                const key = trimmed.substring(0, idx).trim();
                let rawValue = trimmed.substring(idx + 1).trim();
                let comment = '';
                let quote = '';

                // Extract inline comment if it exists outside of quotes
                // This is a naive check; for robust parsing we might need a better parser
                // But for standard .env files, usually # starts a comment unless quoted.

                // Check for quotes
                let value = rawValue;
                const first = rawValue[0];

                if (first === '"' || first === "'") {
                    // It starts with a quote, let's find the closing one
                    let closingIdx = -1;
                    for (let i = 1; i < rawValue.length; i++) {
                        if (rawValue[i] === first && rawValue[i - 1] !== '\\') {
                            closingIdx = i;
                            break;
                        }
                    }

                    if (closingIdx !== -1) {
                        // Found a valid closing quote
                        quote = first;
                        value = rawValue.substring(1, closingIdx); // Extract content inside quotes

                        // Check for comment in remainder
                        const remainder = rawValue.substring(closingIdx + 1).trim();
                        if (remainder.startsWith('#')) {
                            comment = remainder;
                        }
                    } else {
                        // Started with quote but no closing quote found?
                        // Treat as unquoted/broken and just look for comment
                        const commentIdx = rawValue.indexOf('#');
                        if (commentIdx !== -1) {
                            comment = rawValue.substring(commentIdx);
                            value = rawValue.substring(0, commentIdx).trim();
                        }
                    }
                } else {
                    // Not quoted
                    const commentIdx = rawValue.indexOf('#');
                    if (commentIdx !== -1) {
                        comment = rawValue.substring(commentIdx);
                        value = rawValue.substring(0, commentIdx).trim();
                    }
                }

                vars.push({
                    key,
                    value,
                    quote,
                    comment
                });
            }
        });

        setParsedVars(vars);
    }, [content]);

    const updateFromVars = (vars: ParsedEnvVar[]) => {
        setParsedVars(vars);

        // Reconstruct content by merging parsed vars with original file structure is hard 
        // because we only parsed vars and skipped comments/empty lines.
        // For now, simpler approach: regeneration.
        // If we want to preserve comments between lines, we'd need a more complex parser state.
        // Assumption: The user okay with regeneration of variable lines, 
        // BUT we need to preserve the quotes and inline comments we parsed.

        const newContent = vars.map(v => {
            const q = v.quote || (v.value.includes(' ') && !v.quote ? '"' : '');
            // Attempt to preserve original or add quotes if necessary (e.g. spaces)
            return `${v.key}=${q}${v.value}${q}${v.comment ? ' ' + v.comment : ''}`;
        }).join('\n');

        onChange(newContent);
    };

    const handleAdd = (key: string, value: string) => {
        // New vars get double quotes if they have spaces, otherwise none?
        // Or default to none.
        const q = value.includes(' ') ? '"' : '';
        updateFromVars([...parsedVars, { key, value, quote: q }]);
    };

    const handleUpdate = (originalKey: string, newKey: string, newValue: string) => {
        const index = parsedVars.findIndex(v => v.key === originalKey);
        if (index !== -1) {
            const newVars = [...parsedVars];
            // Preserve existing quote style unless value changes require it?
            // If value has spaces and no quote, add quotes.
            let q = newVars[index].quote || '';
            if (!q && newValue.includes(' ')) {
                q = '"';
            }
            // If value no longer needs quotes and we want to keep them? usually yes.

            newVars[index] = {
                ...newVars[index],
                key: newKey,
                value: newValue,
                quote: q
            };
            updateFromVars(newVars);
        }
    };

    const handleDelete = (key: string) => {
        const newVars = parsedVars.filter(v => v.key !== key);
        updateFromVars(newVars);
    };

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e]">
            {/* Toggle Header */}
            <div className="flex justify-between items-center px-6 py-3 border-b border-slate-700 bg-[var(--color-surface)]">
                <div className="flex gap-2 bg-black/20 p-1 rounded-lg">
                    <button
                        onClick={() => setMode('form')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'form' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <Eye className="w-3.5 h-3.5" /> Form
                    </button>
                    <button
                        onClick={() => setMode('code')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'code' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <Code className="w-3.5 h-3.5" /> Code (Raw)
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {mode === 'code' ? (
                    <textarea
                        className="w-full h-full bg-[#1e1e1e] text-slate-300 p-6 font-mono text-sm resize-none focus:outline-none leading-relaxed custom-scrollbar"
                        value={content}
                        onChange={(e) => onChange(e.target.value)}
                        spellCheck={false}
                    />
                ) : (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 p-4 min-h-0">
                            <div className="mb-2 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                Pipeline Variables <span className="text-emerald-500 text-[10px] bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Local</span>
                            </div>
                            <EnvManager
                                variables={parsedVars}
                                onAdd={handleAdd}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                            />
                        </div>

                        {/* Global Variables Section */}
                        {globalVars.length > 0 && (
                            <div className="h-1/3 border-t border-slate-700 bg-slate-900/30 p-4 flex flex-col min-h-0">
                                <div className="mb-3 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 flex-shrink-0">
                                    Inherited Variables <span className="text-blue-400 text-[10px] bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">Global</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 overflow-y-auto pr-2 custom-scrollbar min-h-0 flex-1">
                                    {globalVars.map(key => {
                                        const isOverridden = parsedVars.some(v => v.key === key);
                                        return (
                                            <div key={key} className={`flex items-center justify-between p-2 rounded border flex-shrink-0 ${isOverridden ? 'bg-yellow-500/5 border-yellow-500/20 opacity-75' : 'bg-slate-800/50 border-slate-700'}`}>
                                                <div className="font-mono text-xs text-blue-300 truncate" title={key}>{key}</div>
                                                {isOverridden && <span className="text-[10px] text-yellow-500 font-bold uppercase ml-2">Overridden</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default EnvironmentTab;
