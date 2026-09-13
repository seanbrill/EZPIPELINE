import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { parse, stringify } from 'yaml';
import { GripVertical, X, Plus, Terminal, Eye, Code, CheckCircle2, Wrench, ChevronDown, Zap } from 'lucide-react';

/**
 * The verbs an anytime action can perform, and what each one needs.
 *
 * Mirrors ACTION_KINDS in the server's ActionRunner. Kept here as well rather
 * than fetched, because this is a form and a form that cannot draw itself
 * until a request returns is a form that flickers.
 *
 * `fields` is what the editor renders for that verb. Anything the server
 * accepts and this does not list is still editable in the YAML tab, which
 * stays the source of truth.
 */
const ACTION_KINDS: {
    value: string;
    label: string;
    hint: string;
    fields: { key: string; label: string; placeholder?: string; type?: 'text' | 'checkbox' }[];
}[] = [
    {
        value: 'run-pipeline',
        label: 'Start another pipeline',
        hint: 'Its own approval gates still apply unless you tick auto-approve.',
        fields: [
            { key: 'pipeline', label: 'Pipeline id', placeholder: '7c1f3a58-...' },
            { key: 'autoApprove', label: 'Skip that pipeline\u2019s approval gates', type: 'checkbox' },
        ],
    },
    {
        value: 'merge-branch',
        label: 'Merge one branch into another',
        hint: 'Fast-forward only, so it can never invent a merge commit or overwrite work.',
        fields: [
            { key: 'from', label: 'From', placeholder: 'develop' },
            { key: 'into', label: 'Into', placeholder: 'main' },
            { key: 'repo', label: 'Repository (optional)', placeholder: 'defaults to this pipeline\u2019s git watch' },
        ],
    },
    {
        value: 'shell',
        label: 'Run a command',
        hint: 'Runs on the EZPIPELINE host, not in a pipeline workspace.',
        fields: [{ key: 'run', label: 'Command', placeholder: 'echo hello' }],
    },
    {
        value: 'notify',
        label: 'Write a notice',
        hint: 'Puts a line in the log. Says something happened; does nothing.',
        fields: [{ key: 'message', label: 'Message', placeholder: 'Promoted to production' }],
    },
];

interface StepsTabProps {
    content: string;
    onChange: (newContent: string) => void;
    resources: string[];
    globalResources?: string[];
    envVars: string[];
    globalEnvVars?: string[];
}

const StepsTab: React.FC<StepsTabProps> = ({ content, onChange, resources, globalResources = [], envVars, globalEnvVars = [] }) => {
    const [mode, setMode] = useState<'visual' | 'code'>('visual');
    const toast = useToast();
    const [parsed, setParsed] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const isInternalUpdate = useRef(false);

    // Sync content to parsed state
    useEffect(() => {
        if (isInternalUpdate.current) {
            isInternalUpdate.current = false;
            return;
        }
        try {
            const p = parse(content);
            setParsed(p || {});
            setError(null);
        } catch (e) {
            setError("Invalid YAML. Please fix syntax in Code view.");
        }
    }, [content]);

    const handleChange = (field: string, value: any) => {
        if (!parsed) return;
        const newParsed = { ...parsed, [field]: value };
        setParsed(newParsed);
        isInternalUpdate.current = true;
        try {
            onChange(stringify(newParsed));
        } catch (e) {
            console.error("YAML serialization failed:", e);
        }
    };

    const handleStepChange = (index: number, field: string, value: any) => {
        if (!parsed || !parsed.steps) return;
        const newSteps = [...parsed.steps];
        newSteps[index] = { ...newSteps[index], [field]: value };
        handleChange('steps', newSteps);
    };

    const addStep = (type: 'shell' | 'approval' | 'action' = 'shell') => {
        const currentSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
        const newStep = type === 'approval'
            ? { name: 'Approval Gate', type: 'approval' }
            : type === 'action'
                // Starts with one action and confirmation ON. A button that
                // does something the moment it is created, before anybody has
                // said what it does, is the wrong default.
                ? { name: 'Promote', type: 'action', confirm: true, actions: [{ do: 'run-pipeline' }] }
                : { name: 'New Step', run: 'echo "hello"', continueOnError: false, shell: 'bash' };

        const newSteps = [...currentSteps, newStep];
        handleChange('steps', newSteps);
    };

    /** Read the chain off a step, tolerating a step that has none yet. */
    const chainOf = (step: any): any[] => (Array.isArray(step?.actions) ? step.actions : []);

    const setChain = (idx: number, chain: any[]) => handleStepChange(idx, 'actions', chain);

    const setActionField = (idx: number, ai: number, key: string, value: unknown) => {
        const chain = [...chainOf(parsed?.steps?.[idx])];
        const next = { ...chain[ai] };
        // An empty optional field is REMOVED rather than written as "", so the
        // yaml stays the shape somebody would have typed and the server's
        // "was this supplied" checks keep working.
        if (value === '' || value === false) delete next[key];
        else next[key] = value;
        chain[ai] = next;
        setChain(idx, chain);
    };

    const removeStep = (index: number) => {
        if (!parsed?.steps) return;
        const newSteps = [...parsed.steps];
        newSteps.splice(index, 1);
        handleChange('steps', newSteps);
    };

    /**
     * Which steps are open, by index.
     *
     * A SET OF OPEN ONES, not of closed ones, so a pipeline that grows a step
     * gets it collapsed like the rest rather than open because nobody had
     * closed it yet.
     */
    const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());

    /**
     * Collapsed by default once there are more than four steps.
     *
     * Below that the whole list fits and hiding it would be ceremony. Above
     * it, the editor is a page you scroll for a minute to reach step twelve,
     * and "which steps does this have" cannot be seen at all.
     *
     * Keyed on the step COUNT rather than run once on mount: opening a
     * different pipeline in the same modal should get the same treatment, and
     * it is the only thing that changes when one does.
     */
    const stepCount = Array.isArray(parsed?.steps) ? parsed.steps.length : 0;
    useEffect(() => {
        setOpenSteps(stepCount > 4 ? new Set() : new Set(Array.from({ length: stepCount }, (_, i) => i)));
    }, [stepCount]);

    const toggleStep = (idx: number) =>
        setOpenSteps(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });

    /** One line saying what a collapsed step is, without opening it. */
    const stepSummary = (step: any): string => {
        if (step?.type === 'approval') return 'Approval gate';
        if (step?.type === 'action') {
            const chain = Array.isArray(step.actions) ? step.actions : [];
            return chain.length ? `Anytime action: ${chain.map((a: any) => a?.do).filter(Boolean).join(' then ')}` : 'Anytime action';
        }
        const first = String(step?.run ?? '')
            .split('\n')
            .map((l: string) => l.trim())
            // The first line that is neither blank nor a comment, because
            // `set -euo pipefail` and a comment block are what every one of
            // these starts with and say nothing about this step.
            .find((l: string) => l && !l.startsWith('#') && l !== 'set -euo pipefail');
        return first ? first.slice(0, 90) : 'No command';
    };

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === dropIndex) return;
        if (!parsed || !parsed.steps) return;

        const newSteps = [...parsed.steps];
        const [movedStep] = newSteps.splice(draggedIndex, 1);
        newSteps.splice(dropIndex, 0, movedStep);

        handleChange('steps', newSteps);
        setDraggedIndex(null);
    };

    // --- Metadata Management ---
    const metadata = parsed?.metadata || {};
    const handleMetadataChange = (key: string, value: string) => {
        const newMetadata = { ...metadata, [key]: value };
        handleChange('metadata', newMetadata);
    };
    const addMetadata = () => {
        const newKey = `NEW_KEY_${Object.keys(metadata).length + 1}`;
        handleMetadataChange(newKey, 'value');
    };
    const removeMetadata = (key: string) => {
        const newMetadata = { ...metadata };
        delete newMetadata[key];
        handleChange('metadata', newMetadata);
    };
    const renameMetadataKey = (oldKey: string, newKey: string) => {
        if (oldKey === newKey) return;
        const newMetadata = { ...metadata };
        newMetadata[newKey] = newMetadata[oldKey];
        delete newMetadata[oldKey];
        handleChange('metadata', newMetadata);
    };

    // --- YAML Tools ---
    const validateYaml = () => {
        try {
            parse(content);
            toast.success("YAML is valid! ✅");
        } catch (e: any) {
            toast.error(`Invalid YAML: ${e.message} ❌`);
        }
    };

    const fixYaml = () => {
        if (!parsed) return;
        // Standardize order: targetName, appName, version, description, environment, metadata, ... rest
        const { id, appName, version, description, environment, metadata, steps, ...rest } = parsed;
        const ordered = {
            id: id || 'unknown-pipeline',
            appName: appName || 'Unnamed Pipeline',
            version: version || '1.0.0',
            description: description || '',
            environment: environment || 'development',
            metadata: metadata || {},
            steps: steps || [],
            ...rest
        };
        const fixed = stringify(ordered);
        onChange(fixed);
        toast.success("YAML formatted and standardized! ✨");
    };

    // --- Variable Injection Modal State ---
    const [variableModalOpen, setVariableModalOpen] = useState(false);
    const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);

    const openVariableModal = (index: number) => {
        setActiveStepIndex(index);
        setVariableModalOpen(true);
    };

    const handleInsertVariable = (variable: string) => {
        if (activeStepIndex === null || !parsed || !parsed.steps) return;

        const idx = activeStepIndex;
        const step = parsed.steps[idx];
        const textToInsert = `\${${variable}}`;
        const el = document.getElementById(`step-run-${idx}`) as HTMLTextAreaElement;

        if (el) {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const text = step.run || '';
            const newText = text.substring(0, start) + textToInsert + text.substring(end);
            handleStepChange(idx, 'run', newText);

            // Restore focus and cursor
            setTimeout(() => {
                el.focus();
                el.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
            }, 0);
        } else {
            handleStepChange(idx, 'run', (step.run || '') + textToInsert);
        }
        setVariableModalOpen(false);
    };

    // --- Variable Injection Modal Component ---
    const VariableModal = () => (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={() => setVariableModalOpen(false)}>
            <div className="bg-[#1e1e1e] border border-slate-700 rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Terminal className="w-5 h-5 text-emerald-500" />
                        Insert Variable
                    </h3>
                    <button onClick={() => setVariableModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 overflow-y-auto custom-scrollbar space-y-6">
                    {/* Standard Variables */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                            Standard Variables
                        </h4>
                        <div className="grid grid-cols-2 gap-2">
                            {['TARGET_NAME', 'PIPELINE_NAME', 'PIPELINE_VERSION', 'BUILD_ID', 'ENV_FILE'].map(v => (
                                <button
                                    key={v}
                                    onClick={() => handleInsertVariable(v)}
                                    className="text-left px-3 py-2 bg-slate-900/50 hover:bg-purple-900/20 border border-slate-800 hover:border-purple-500/50 rounded-lg text-sm text-purple-300 font-mono transition-all truncate"
                                    title={v}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Pipeline Variables (Local) */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            Pipeline Variables <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 rounded">Local</span>
                        </h4>
                        {envVars.length === 0 ? (
                            <p className="text-sm text-slate-600 italic px-2">No local variables defined.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {envVars.map(v => (
                                    <button
                                        key={v}
                                        onClick={() => handleInsertVariable(v)}
                                        className="text-left px-3 py-2 bg-slate-900/50 hover:bg-emerald-900/20 border border-slate-800 hover:border-emerald-500/50 rounded-lg text-sm text-emerald-300 font-mono transition-all truncate"
                                        title={v}
                                    >
                                        {v}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Global Variables */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                            Global Variables <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 rounded border border-blue-500/20">Inherited</span>
                        </h4>
                        {globalEnvVars.length === 0 ? (
                            <p className="text-sm text-slate-600 italic px-2">No global variables available.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {globalEnvVars.map(v => (
                                    <button
                                        key={v}
                                        onClick={() => handleInsertVariable(v)}
                                        className="text-left px-3 py-2 bg-slate-900/50 hover:bg-blue-900/20 border border-slate-800 hover:border-blue-500/50 rounded-lg text-sm text-blue-300 font-mono transition-all truncate"
                                        title={v}
                                    >
                                        {v}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Global Resources */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                            Global Resources
                        </h4>
                        {(!globalResources || globalResources.length === 0) ? (
                            <p className="text-sm text-slate-600 italic px-2">No global resources available.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {globalResources.map(r => (
                                    <button
                                        key={r}
                                        onClick={() => handleInsertVariable(`RESOURCES/${r}`)}
                                        className="text-left px-3 py-2 bg-slate-900/50 hover:bg-indigo-900/20 border border-slate-800 hover:border-indigo-500/50 rounded-lg text-sm text-indigo-300 font-mono transition-all truncate"
                                        title={r}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Pipeline Resources */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            Pipeline Resources
                        </h4>
                        {resources.length === 0 ? (
                            <p className="text-sm text-slate-600 italic px-2">No pipeline resources uploaded.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {resources.map(r => (
                                    <button
                                        key={r}
                                        onClick={() => handleInsertVariable(`RESOURCES/${r}`)}
                                        className="text-left px-3 py-2 bg-slate-900/50 hover:bg-blue-900/20 border border-slate-800 hover:border-blue-500/50 rounded-lg text-sm text-blue-300 font-mono transition-all truncate"
                                        title={r}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Metadata */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                            Metadata
                        </h4>
                        {Object.keys(metadata).length === 0 ? (
                            <p className="text-sm text-slate-600 italic px-2">No metadata defined.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {Object.keys(metadata).map(k => (
                                    <button
                                        key={k}
                                        onClick={() => handleInsertVariable(k)}
                                        className="text-left px-3 py-2 bg-slate-900/50 hover:bg-orange-900/20 border border-slate-800 hover:border-orange-500/50 rounded-lg text-sm text-orange-300 font-mono transition-all truncate"
                                        title={k}
                                    >
                                        {k}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-slate-800 bg-slate-900/30 flex justify-end">
                    <button
                        onClick={() => setVariableModalOpen(false)}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm font-medium"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );

    if (error && mode === 'visual') {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center p-8">
                <p className="text-red-400 mb-4">{error}</p>
                <div className="flex gap-2">
                    <button
                        onClick={() => setMode('code')}
                        className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-700 transition-colors"
                    >
                        Switch to Code View to Fix
                    </button>
                    <button
                        onClick={() => onChange(content)} // Trigger re-parse attempt
                        className="bg-emerald-800 text-white px-4 py-2 rounded hover:bg-emerald-700 transition-colors"
                    >
                        Retry Parsing
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e]">
            {/* Toggle Header */}
            <div className="flex justify-between items-center px-6 py-3 border-b border-slate-700 bg-[var(--color-surface)]">
                <div className="flex gap-2 bg-black/20 p-1 rounded-lg">
                    <button
                        onClick={() => setMode('visual')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'visual' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <Eye className="w-3.5 h-3.5" /> Visual
                    </button>
                    <button
                        onClick={() => setMode('code')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'code' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <Code className="w-3.5 h-3.5" /> Code (YAML)
                    </button>
                </div>

                {mode === 'code' && (
                    <div className="flex gap-2">
                        <button onClick={validateYaml} className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Validate
                        </button>
                        <button onClick={fixYaml} className="text-xs text-slate-400 hover:text-blue-400 flex items-center gap-1 font-bold">
                            <Wrench className="w-3 h-3" /> Fix & Format
                        </button>
                    </div>
                )}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                {mode === 'code' ? (
                    <textarea
                        className="w-full h-full bg-[#1e1e1e] text-slate-300 p-6 font-mono text-sm resize-none focus:outline-none leading-relaxed custom-scrollbar"
                        value={content}
                        onChange={(e) => onChange(e.target.value)}
                        spellCheck={false}
                    />
                ) : (
                    <div className="p-6 space-y-8 h-full overflow-y-auto custom-scrollbar scroll-smooth pb-20">
                        <div className="space-y-6">
                            {/* Row 1: Pipeline ID */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pipeline ID</label>
                                <input
                                    className="w-full bg-black/20 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 font-mono outline-none cursor-not-allowed"
                                    value={parsed?.id || 'N/A'}
                                    readOnly
                                    title="Internal Pipeline ID (UUID)"
                                />
                            </div>

                            {/* Row 2: Name & Version */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                <div className="space-y-2 md:col-span-3">
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pipeline Name</label>
                                    <input
                                        className="w-full bg-black/20 border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                        value={parsed?.appName || ''}
                                        onChange={e => handleChange('appName', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2 md:col-span-1">
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Version</label>
                                    <input
                                        className="w-full bg-black/20 border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                        value={parsed?.version || ''}
                                        onChange={e => handleChange('version', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Environment</label>
                            <div className="relative">
                                <select
                                    className="w-full bg-black/20 border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-emerald-500 outline-none transition-colors appearance-none"
                                    value={parsed?.environment || 'development'}
                                    onChange={e => handleChange('environment', e.target.value)}
                                >
                                    <option value="development">Development</option>
                                    <option value="qa">QA</option>
                                    <option value="staging">Staging</option>
                                    <option value="production">Production</option>
                                    <option value="other">Other</option>
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                    <ChevronDown className="w-4 h-4" />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Description</label>
                            <textarea
                                className="w-full bg-black/20 border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-emerald-500 outline-none resize-none h-20 transition-colors"
                                value={parsed?.description || ''}
                                onChange={e => handleChange('description', e.target.value)}
                            />
                        </div>

                        {/* Metadata Editor */}
                        <div className="bg-black/20 border border-slate-700 rounded-lg p-4">
                            <div className="flex justify-between items-center mb-4">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Metadata</label>
                                <button onClick={addMetadata} className="text-xs text-emerald-500 hover:text-emerald-400 font-bold flex items-center gap-1">
                                    <Plus className="w-3 h-3" /> Add Key
                                </button>
                            </div>
                            <div className="space-y-2">
                                {Object.entries(metadata).map(([key, value], idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <input
                                            className="flex-1 bg-slate-900/50 border border-slate-700 rounded p-2 text-xs text-emerald-400 font-mono focus:border-emerald-500 outline-none"
                                            value={key}
                                            onChange={(e) => renameMetadataKey(key, e.target.value)}
                                            placeholder="Key"
                                        />
                                        <input
                                            className="flex-[2] bg-slate-900/50 border border-slate-700 rounded p-2 text-xs text-white  focus:border-emerald-500 outline-none"
                                            value={value as string}
                                            onChange={(e) => handleMetadataChange(key, e.target.value)}
                                            placeholder="Value"
                                        />
                                        <button onClick={() => removeMetadata(key)} className="text-slate-600 hover:text-red-400 p-2">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {Object.keys(metadata).length === 0 && (
                                    <p className="text-xs text-slate-600 italic">No metadata defined.</p>
                                )}
                            </div>
                        </div>

                        {/* Confirmation Toggle */}
                        <div className="p-4 bg-yellow-900/10 border border-yellow-600/30 rounded-lg">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={parsed?.requireConfirmation || false}
                                    onChange={e => handleChange('requireConfirmation', e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-700 bg-black/20 text-yellow-500 focus:ring-yellow-500"
                                />
                                <div className="flex-1">
                                    <span className="text-sm font-semibold text-yellow-500 group-hover:text-yellow-400 transition-colors">
                                        Require confirmation before running
                                    </span>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Recommended for production pipelines. A confirmation dialog will appear before execution.
                                    </p>
                                </div>
                            </label>
                        </div>

                        {/* Steps List */}
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                <h3 className="font-bold text-lg text-white">
                                    Pipeline Steps
                                    <span className="ml-2 text-sm font-normal text-slate-500">
                                        {stepCount}
                                        {openSteps.size > 0 && openSteps.size < stepCount && (
                                            <span className="text-slate-600">, {openSteps.size} open</span>
                                        )}
                                    </span>
                                </h3>
                                {stepCount > 1 && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setOpenSteps(new Set(Array.from({ length: stepCount }, (_, i) => i)))}
                                            className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded px-2 py-1 transition-colors"
                                        >
                                            Expand all
                                        </button>
                                        <button
                                            onClick={() => setOpenSteps(new Set())}
                                            className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded px-2 py-1 transition-colors"
                                        >
                                            Collapse all
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-4">
                                {parsed?.steps?.map((step: any, idx: number) => (
                                    <div
                                        key={idx}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, idx)}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, idx)}
                                        className={`bg-slate-900/40 border rounded-xl p-4 relative group hover:border-slate-600 transition-colors ${draggedIndex === idx ? 'opacity-50 border-emerald-500 border-dashed' : 'border-slate-800'}`}
                                    >
                                        <div className="absolute -left-3 -top-3 w-6 h-6 bg-slate-800 border border-slate-600 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg z-10">
                                            {idx + 1}
                                        </div>

                                        <div className="absolute left-1 top-1/2 -translate-y-1/2 cursor-move text-slate-600 hover:text-slate-300 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <GripVertical className="w-5 h-5" />
                                        </div>

                                        {/* THE COLLAPSED ROW, always rendered. It is the
                                            table of contents when everything is shut and the
                                            handle to close one again when it is open, so it
                                            does not disappear on expand. */}
                                        <button
                                            onClick={() => toggleStep(idx)}
                                            className="w-full flex items-center gap-2 text-left pl-6 pr-2 py-1 group/head"
                                            aria-expanded={openSteps.has(idx)}
                                        >
                                            <ChevronDown
                                                className={`w-4 h-4 flex-shrink-0 text-slate-500 transition-transform ${openSteps.has(idx) ? '' : '-rotate-90'}`}
                                            />
                                            <span className={`text-sm font-bold truncate ${
                                                step.type === 'approval' ? 'text-yellow-500'
                                                    : step.type === 'action' ? 'text-cyan-400'
                                                        : 'text-emerald-400'}`}>
                                                {step.name || '(unnamed)'}
                                            </span>
                                            {!openSteps.has(idx) && (
                                                <span className="text-[11px] font-mono text-slate-600 truncate">
                                                    {stepSummary(step)}
                                                </span>
                                            )}
                                        </button>

                                        {!openSteps.has(idx) ? null : step.type === 'action' ? (
                                            <div className="pl-6 py-2 space-y-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-cyan-900/20 flex items-center justify-center text-cyan-400 border border-cyan-700/50">
                                                        <Zap className="w-6 h-6" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white">Anytime action</h4>
                                                        <p className="text-xs text-slate-400">
                                                            A button on every build of this pipeline. Never runs as part of the
                                                            pipeline; it waits to be pressed, including long after the run has finished.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-12 gap-4">
                                                    <div className="col-span-12 lg:col-span-6">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Button label</label>
                                                        <input
                                                            className="w-full mt-1 bg-black/20 border border-slate-700 rounded p-2 text-sm text-cyan-400 font-bold focus:border-cyan-500 outline-none"
                                                            value={step.name || ''}
                                                            onChange={e => handleStepChange(idx, 'name', e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="col-span-12 lg:col-span-6 flex items-end pb-2">
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={step.confirm !== false}
                                                                onChange={e => handleStepChange(idx, 'confirm', e.target.checked)}
                                                                className="w-4 h-4 rounded border-slate-700 bg-black/20 text-cyan-500"
                                                            />
                                                            <span className="text-xs text-slate-300">
                                                                Ask before running
                                                                <span className="block text-[10px] text-slate-500">
                                                                    Off means one press does it. On means a confirmation first.
                                                                </span>
                                                            </span>
                                                        </label>
                                                    </div>
                                                </div>

                                                <div>
                                                    <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                            Does this, in order
                                                        </label>
                                                        <button
                                                            onClick={() => setChain(idx, [...chainOf(step), { do: 'notify' }])}
                                                            className="bg-slate-800 hover:bg-cyan-900/30 text-slate-400 hover:text-cyan-400 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border border-slate-700"
                                                        >
                                                            <Plus className="w-3 h-3" /> Add action
                                                        </button>
                                                    </div>

                                                    {chainOf(step).length === 0 && (
                                                        <p className="text-xs text-slate-500 italic">
                                                            Nothing yet. The button stays disabled until there is at least one action.
                                                        </p>
                                                    )}

                                                    <div className="space-y-3">
                                                        {chainOf(step).map((action: any, ai: number) => {
                                                            const kind = ACTION_KINDS.find(k => k.value === action.do);
                                                            return (
                                                                <div key={ai} className="bg-black/20 border border-slate-800 rounded-lg p-3">
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <span className="text-[10px] font-mono text-slate-600 w-4">{ai + 1}</span>
                                                                        <select
                                                                            className="flex-1 bg-black/30 border border-slate-700 rounded p-2 text-xs text-slate-200 focus:border-cyan-500 outline-none"
                                                                            value={action.do || ''}
                                                                            onChange={e => {
                                                                                // Switching the verb drops the old verb's fields,
                                                                                // which would otherwise sit in the yaml meaning
                                                                                // nothing and reappear if it were switched back.
                                                                                const chain = [...chainOf(step)];
                                                                                chain[ai] = { do: e.target.value };
                                                                                setChain(idx, chain);
                                                                            }}
                                                                        >
                                                                            <option value="">Choose an action...</option>
                                                                            {ACTION_KINDS.map(k => (
                                                                                <option key={k.value} value={k.value}>{k.label}</option>
                                                                            ))}
                                                                        </select>
                                                                        <button
                                                                            onClick={() => setChain(idx, chainOf(step).filter((_: any, i: number) => i !== ai))}
                                                                            className="p-1.5 text-slate-600 hover:text-red-400 transition-colors"
                                                                            title="Remove this action"
                                                                        >
                                                                            <X className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>

                                                                    {kind && (
                                                                        <>
                                                                            <p className="text-[10px] text-slate-500 mb-2 pl-6">{kind.hint}</p>
                                                                            <div className="grid grid-cols-12 gap-2 pl-6">
                                                                                {kind.fields.map(f => (
                                                                                    <div key={f.key} className={f.type === 'checkbox' ? 'col-span-12' : 'col-span-12 sm:col-span-6'}>
                                                                                        {f.type === 'checkbox' ? (
                                                                                            <label className="flex items-center gap-2 cursor-pointer py-1">
                                                                                                <input
                                                                                                    type="checkbox"
                                                                                                    checked={action[f.key] === true}
                                                                                                    onChange={e => setActionField(idx, ai, f.key, e.target.checked)}
                                                                                                    className="w-4 h-4 rounded border-slate-700 bg-black/20 text-cyan-500"
                                                                                                />
                                                                                                <span className="text-xs text-slate-300">{f.label}</span>
                                                                                            </label>
                                                                                        ) : (
                                                                                            <>
                                                                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{f.label}</label>
                                                                                                <input
                                                                                                    className="w-full mt-1 bg-black/30 border border-slate-700 rounded p-2 text-xs font-mono text-slate-200 focus:border-cyan-500 outline-none"
                                                                                                    value={typeof action[f.key] === 'string' ? action[f.key] : ''}
                                                                                                    placeholder={f.placeholder}
                                                                                                    onChange={e => setActionField(idx, ai, f.key, e.target.value)}
                                                                                                />
                                                                                            </>
                                                                                        )}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Description (Optional)</label>
                                                    <textarea
                                                        className="w-full mt-1 bg-black/20 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-300 focus:border-slate-500 outline-none resize-y h-20"
                                                        value={step.description || ''}
                                                        onChange={e => handleStepChange(idx, 'description', e.target.value)}
                                                        placeholder="Shown when somebody hovers the button."
                                                    />
                                                </div>
                                            </div>
                                        ) : step.type === 'approval' ? (
                                            <div className="pl-6 py-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-yellow-900/20 flex items-center justify-center text-yellow-500 border border-yellow-700/50">
                                                        <CheckCircle2 className="w-6 h-6" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white">Approval Gate</h4>
                                                        <p className="text-xs text-slate-400">Pipeline will pause here until manually approved.</p>
                                                    </div>
                                                </div>
                                                <div className="mt-4">
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Step Name</label>
                                                    <input
                                                        className="w-full mt-1 bg-black/20 border border-slate-700 rounded p-2 text-sm text-yellow-500 font-bold focus:border-yellow-500 outline-none"
                                                        value={step.name || 'Approval'}
                                                        onChange={e => handleStepChange(idx, 'name', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-4 pl-6">
                                                <div className="grid grid-cols-12 gap-6">
                                                    {/* Three columns for the metadata, nine for the script.
                                                        The left side holds a name, a shell picker and a
                                                        checkbox; the right holds the thing anybody opened
                                                        this to read. It used to be four and eight. */}
                                                    <div className="col-span-12 lg:col-span-3 space-y-5">
                                                        <div className="space-y-1.5">
                                                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Step Name</label>
                                                            <input
                                                                className="w-full bg-black/20 border border-slate-700 rounded p-2.5 text-sm text-emerald-400 font-bold focus:border-emerald-500 outline-none transition-colors shadow-sm"
                                                                value={step.name || ''}
                                                                onChange={e => handleStepChange(idx, 'name', e.target.value)}
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-1.5">
                                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Shell</label>
                                                                <select
                                                                    className="w-full bg-black/20 border border-slate-700 rounded p-2 text-xs text-slate-300 focus:border-slate-500 outline-none transition-colors"
                                                                    value={step.shell || 'bash'}
                                                                    onChange={e => handleStepChange(idx, 'shell', e.target.value)}
                                                                >
                                                                    <option value="bash">Bash</option>
                                                                    <option value="sh">Sh</option>
                                                                    <option value="node">Node.js</option>
                                                                    <option value="python">Python</option>
                                                                </select>
                                                            </div>
                                                            <div className="flex items-end pb-2">
                                                                <label className="flex items-center gap-2 cursor-pointer group/check">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={step.continueOnError || false}
                                                                        onChange={e => handleStepChange(idx, 'continueOnError', e.target.checked)}
                                                                        className="w-4 h-4 rounded border-slate-700 bg-black/20 text-emerald-500 focus:ring-emerald-500 transition-colors"
                                                                    />
                                                                    <span className="text-[10px] font-bold text-slate-500 group-hover/check:text-slate-400 uppercase tracking-wider transition-colors">Continue Error</span>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="col-span-12 lg:col-span-9 space-y-1.5 flex flex-col">
                                                        <div className="flex justify-between items-end border-b border-slate-800 pb-2 mb-1">
                                                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Run Command</label>

                                                            <button
                                                                onClick={() => openVariableModal(idx)}
                                                                className="bg-slate-800 hover:bg-emerald-900/30 text-slate-400 hover:text-emerald-400 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all border border-slate-700 hover:border-emerald-500/50"
                                                            >
                                                                <Plus className="w-3 h-3" /> Insert Variable
                                                            </button>
                                                        </div>

                                                        <textarea
                                                            id={`step-run-${idx}`}
                                                            // 128px showed about five lines of a step that is
                                                            // routinely forty, so reading one meant scrolling a
                                                            // small box inside a large empty modal. Sized off the
                                                            // viewport with a floor, and still resizable by hand.
                                                            className="w-full h-[42vh] min-h-64 bg-black/40 border border-slate-800 rounded-lg p-3 text-xs font-mono text-blue-200 focus:border-blue-500 outline-none resize-y leading-relaxed custom-scrollbar shadow-inner"
                                                            value={step.run || ''}
                                                            onChange={e => handleStepChange(idx, 'run', e.target.value)}
                                                            spellCheck={false}
                                                            placeholder="# commands to run..."
                                                        />
                                                    </div>
                                                </div>

                                                {/* Description moved below run command */}
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Description (Optional)</label>
                                                    <textarea
                                                        // resize-y rather than resize-none: these descriptions
                                                        // run to a paragraph in this repository, and a fixed
                                                        // four-line box with no handle hid most of one.
                                                        className="w-full bg-black/20 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-300 focus:border-slate-500 outline-none resize-y h-24 transition-colors"
                                                        value={step.description || ''}
                                                        onChange={e => handleStepChange(idx, 'description', e.target.value)}
                                                        placeholder="e.g. Builds the frontend using npm"
                                                    />
                                                </div>

                                                {/* Delete button moved to bottom-left */}
                                                <div className="flex justify-start pt-2">
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm(`Delete step "${step.name}"?`)) {
                                                                removeStep(idx);
                                                            }
                                                        }}
                                                        className="text-slate-600 hover:text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded border border-slate-700 hover:border-red-500/50 transition-all flex items-center gap-2 text-xs font-bold"
                                                    >
                                                        <X className="w-3.5 h-3.5" /> Delete Step
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => addStep('shell')}
                                        className="border border-dashed border-slate-700 rounded-xl p-4 flex items-center justify-center gap-2 text-slate-400 hover:border-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/5 transition-all group"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                                            <Terminal className="w-4 h-4" />
                                        </div>
                                        <span className="font-bold">Add Shell Step</span>
                                    </button>
                                    <button
                                        onClick={() => addStep('approval')}
                                        className="border border-dashed border-slate-700 rounded-xl p-4 flex items-center justify-center gap-2 text-slate-400 hover:border-yellow-500 hover:text-yellow-500 hover:bg-yellow-500/5 transition-all group"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-yellow-500/20 transition-colors">
                                            <CheckCircle2 className="w-4 h-4" />
                                        </div>
                                        <span className="font-bold">Add Approval Gate</span>
                                    </button>
                                    <button
                                        onClick={() => addStep('action')}
                                        className="border border-dashed border-slate-700 rounded-xl p-4 flex items-center justify-center gap-2 text-slate-400 hover:border-cyan-500 hover:text-cyan-500 hover:bg-cyan-500/5 transition-all group"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                                            <Zap className="w-4 h-4" />
                                        </div>
                                        <span className="font-bold">Add Approval Gate</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Render Modal if Open */}
            {variableModalOpen && <VariableModal />}
        </div>
    );
};
export default StepsTab;
