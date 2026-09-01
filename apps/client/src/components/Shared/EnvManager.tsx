import React, { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, X, Edit2, Key, AlertCircle, Check } from 'lucide-react';

interface EnvVar {
    key: string;
    value: string;
    quote?: string;
    comment?: string;
}

interface EnvManagerProps {
    variables: EnvVar[];
    onAdd?: (key: string, value: string) => Promise<void> | void;
    onUpdate?: (originalKey: string, newKey: string, newValue: string) => Promise<void> | void;
    onDelete?: (key: string) => Promise<void> | void;
    isLoading?: boolean;
}

const EnvVarRow = ({
    envVar,
    onDelete,
    isEditing,
    startEdit,
    cancelEdit,
    saveEdit,
    editKeyInput,
    setEditKeyInput,
    editValueInput,
    setEditValueInput
}: {
    envVar: EnvVar;
    onUpdate?: (originalKey: string, newKey: string, newValue: string) => Promise<void> | void;
    onDelete?: (key: string) => Promise<void> | void;
    isEditing: boolean;
    startEdit: () => void;
    cancelEdit: () => void;
    saveEdit: () => void;
    editKeyInput: string;
    setEditKeyInput: (val: string) => void;
    editValueInput: string;
    setEditValueInput: (val: string) => void;
}) => {
    const [showValue, setShowValue] = useState(false);

    return (
        <div
            className={`flex flex-col md:flex-row gap-3 items-center p-2 rounded-lg border transition-all group ${isEditing
                ? 'bg-slate-800/50 border-emerald-500/50'
                : 'bg-slate-800/20 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                }`}
        >
            {/* Key Field */}
            <div className="flex-[2] w-full min-w-0">
                {isEditing ? (
                    <input
                        value={editKeyInput}
                        onChange={(e) => setEditKeyInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                        className="w-full bg-black/40 border border-emerald-500/50 rounded px-2 py-1.5 text-emerald-400 font-mono text-sm focus:outline-none"
                        autoFocus
                    />
                ) : (
                    <div className="font-mono text-emerald-400 font-bold px-2 truncate flex items-center gap-2" title={envVar.key}>
                        <span className="opacity-50 select-none">#</span> {envVar.key}
                    </div>
                )}
            </div>

            {/* Divider */}
            <div className="hidden md:flex text-slate-700 font-bold select-none w-4 justify-center">=</div>

            {/* Value Field */}
            <div className="flex-[3] w-full relative min-w-0">
                {isEditing ? (
                    <div className="relative">
                        <input
                            type={showValue ? "text" : "password"}
                            value={editValueInput}
                            onChange={(e) => setEditValueInput(e.target.value)}
                            className="w-full bg-black/40 border border-emerald-500/50 rounded px-2 py-1.5 text-white font-mono text-sm focus:outline-none pr-8"
                        />
                        <button
                            onClick={() => setShowValue(!showValue)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                        >
                            {showValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                ) : (
                    <div className="bg-black/20 rounded px-3 py-1.5 border border-transparent group-hover:border-slate-700/50 flex justify-between items-center h-full">
                        <span className="font-mono text-slate-300 text-sm truncate" title={showValue ? envVar.value : undefined}>
                            {showValue ? envVar.value : '••••••••••••••••'}
                        </span>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 self-end md:self-center w-[100px] justify-end">
                {isEditing ? (
                    <>
                        <button onClick={saveEdit} className="p-2 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors" title="Save">
                            <Check className="w-4 h-4" />
                        </button>
                        <button onClick={cancelEdit} className="p-2 text-slate-400 hover:bg-slate-700/50 rounded-lg transition-colors" title="Cancel">
                            <X className="w-4 h-4" />
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={() => setShowValue(!showValue)}
                            className={`p-2 rounded-lg transition-colors ${showValue ? 'text-slate-200 bg-white/5' : 'text-slate-500 hover:text-slate-300'}`}
                            title={showValue ? "Hide" : "Reveal"}
                        >
                            {showValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                            onClick={startEdit}
                            className="p-2 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            title="Edit"
                        >
                            <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => onDelete && onDelete(envVar.key)}
                            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

const EnvManager: React.FC<EnvManagerProps> = ({
    variables,
    onAdd,
    onUpdate,
    onDelete,
    isLoading = false
}) => {
    // Add New State
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [showNewValue, setShowNewValue] = useState(false);

    // Edit State
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editKeyInput, setEditKeyInput] = useState('');
    const [editValueInput, setEditValueInput] = useState('');

    const handleAdd = async () => {
        if (!newKey.trim() || !onAdd) return;
        await onAdd(newKey, newValue);
        setNewKey('');
        setNewValue('');
    };

    const startEdit = (v: EnvVar) => {
        setEditingKey(v.key);
        setEditKeyInput(v.key);
        setEditValueInput(v.value);
    };

    const cancelEdit = () => {
        setEditingKey(null);
        setEditKeyInput('');
        setEditValueInput('');
    };

    const handleUpdate = async () => {
        if (!editingKey || !onUpdate) return;
        await onUpdate(editingKey, editKeyInput, editValueInput);
        setEditingKey(null);
    };

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] rounded-xl overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar h-full relative">
                {/* Add Section - Sticky Header */}
                <div className="sticky top-0 z-20 py-4 px-2 bg-[#1e1e1e]/95 backdrop-blur-sm border-b border-slate-700 shadow-xl">
                    <div className="flex flex-col md:flex-row gap-3 items-stretch px-2 border border-transparent">
                        <div className="flex-[2] relative group">
                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                <Key className="w-4 h-4 text-emerald-500/50 group-focus-within:text-emerald-500 transition-colors" />
                            </div>
                            <input
                                type="text"
                                value={newKey}
                                onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                                placeholder="NEW_ENV_KEY"
                                className="w-full bg-black/40 border border-slate-700 text-emerald-400 font-mono text-sm rounded-lg pl-10 pr-4 py-2.5 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder:text-slate-600"
                            />
                        </div>
                        {/* Spacer to match divider width */}
                        <div className="hidden md:flex w-4 justify-center"></div>

                        <div className="flex-[3] relative group">
                            <input
                                type={showNewValue ? "text" : "password"}
                                value={newValue}
                                onChange={(e) => setNewValue(e.target.value)}
                                placeholder="Enter value..."
                                className="w-full bg-black/40 border border-slate-700 text-white font-mono text-sm rounded-lg pl-4 pr-10 py-2.5 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder:text-slate-600"
                            />
                            <button
                                onClick={() => setShowNewValue(!showNewValue)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                            >
                                {showNewValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        {/* Action Area width match */}
                        <div className="w-[100px] flex justify-end">
                            <button
                                onClick={handleAdd}
                                disabled={!newKey.trim() || isLoading}
                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-emerald-900/20 flex items-center gap-2 transition-all active:scale-95 whitespace-nowrap w-full justify-center"
                            >
                                <Plus className="w-4 h-4" /> Add
                            </button>
                        </div>
                    </div>
                </div>

                {/* List Section */}
                <div className="py-4 px-2 space-y-2">
                    {variables.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl">
                            <AlertCircle className="w-8 h-8 opacity-20 mb-2" />
                            <p>No environment variables defined.</p>
                        </div>
                    ) : (
                        variables.map((envVar) => (
                            <EnvVarRow
                                key={envVar.key}
                                envVar={envVar}
                                isEditing={editingKey === envVar.key}
                                onDelete={onDelete}
                                startEdit={() => startEdit(envVar)}
                                cancelEdit={cancelEdit}
                                saveEdit={handleUpdate}
                                editKeyInput={editKeyInput}
                                setEditKeyInput={setEditKeyInput}
                                editValueInput={editValueInput}
                                setEditValueInput={setEditValueInput}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default EnvManager;
