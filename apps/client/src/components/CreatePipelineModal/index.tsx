import React, { useState } from 'react';
import { X, Save, Copy } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import API_URL from '../../config/api';

interface Pipeline {
    id: string;
    appName: string;
    group?: string;
    description?: string;
}

interface CreatePipelineModalProps {
    onClose: () => void;
    onCreated: () => void;
    availableGroups: string[];
    defaultGroup?: string;
    existingPipelines?: Pipeline[];
}

const CreatePipelineModal: React.FC<CreatePipelineModalProps> = ({ onClose, onCreated, availableGroups, defaultGroup, existingPipelines = [] }) => {
    const { token } = useAuth();
    const [appName, setAppName] = useState('');
    const [group, setGroup] = useState(defaultGroup || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [mode, setMode] = useState<'new' | 'copy'>('new');
    const [sourcePipelineId, setSourcePipelineId] = useState('');

    const handleCreate = async () => {
        if (!appName) {
            setError("App Name is required");
            return;
        }

        if (mode === 'copy' && !sourcePipelineId) {
            setError("Please select a source pipeline to copy");
            return;
        }

        setLoading(true);
        setError('');

        try {
            let res;
            if (mode === 'new') {
                res = await fetch(`${API_URL}/api/config/create-pipeline`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        name: appName,
                        group: group
                    })
                });
            } else {
                res = await fetch(`${API_URL}/api/config/copy-pipeline`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        sourceId: sourcePipelineId,
                        name: appName,
                        group: group
                    })
                });
            }

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to create pipeline");
            }

            onCreated();
            onClose();
        } catch (e: any) {
            setError(e.message || "Failed to create pipeline");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#1e1e1e] rounded-xl border border-slate-700 shadow-2xl w-full max-w-md flex flex-col">
                <div className="flex justify-between items-center p-4 border-b border-slate-700">
                    <h2 className="text-xl font-bold text-white">Create New Pipeline</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {/* Mode Selector */}
                    <div className="flex bg-slate-900/50 p-1 rounded-lg">
                        <button
                            onClick={() => setMode('new')}
                            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${mode === 'new' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Blank Pipeline
                        </button>
                        <button
                            onClick={() => setMode('copy')}
                            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${mode === 'copy' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Copy Existing
                        </button>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Pipeline Name</label>
                        <input
                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                            value={appName}
                            onChange={e => setAppName(e.target.value)}
                            placeholder="My Application"
                            autoFocus
                        />
                        <p className="text-xs text-slate-500">
                            ID: <span className="font-mono text-emerald-400">{appName ? appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '...'}</span> will be generated automatically.
                        </p>
                    </div>

                    {mode === 'copy' && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                            <label className="text-sm font-medium text-slate-300">Source Pipeline</label>
                            <select
                                value={sourcePipelineId}
                                onChange={(e) => setSourcePipelineId(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                            >
                                <option value="">Select source...</option>
                                {existingPipelines.map(p => (
                                    <option key={p.id} value={p.id}>{p.appName} {p.group ? `(${p.group})` : ''}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Group/Folder</label>
                        <select
                            value={group}
                            onChange={(e) => setGroup(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                        >
                            <option value="">(Root)</option>
                            {availableGroups.filter(g => g !== 'General' && g !== 'All').map(g => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                    </div>

                    {error && <p className="text-red-400 text-sm">{error}</p>}

                    <div className="flex justify-center pt-4">
                        <button
                            onClick={handleCreate}
                            disabled={loading}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {mode === 'copy' ? <Copy className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                            {loading ? (mode === 'copy' ? "Copying..." : "Creating...") : (mode === 'copy' ? "Copy Pipeline" : "Create Pipeline")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CreatePipelineModal;
