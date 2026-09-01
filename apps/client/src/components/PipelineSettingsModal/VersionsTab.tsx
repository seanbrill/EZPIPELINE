import React, { useState, useEffect } from 'react';
import { Trash2, Download, RotateCcw, AlertTriangle, FileCode, RefreshCw } from 'lucide-react';
import { format } from "date-fns";
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import API_URL from '../../config/api';

interface VersionsTabProps {
    pipelineTarget: string;
}

interface Version {
    name: string;
    size: number;
    created: string;
    modified: string;
}

const VersionsTab: React.FC<VersionsTabProps> = ({ pipelineTarget }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();
    const [versions, setVersions] = useState<Version[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Rollback State
    const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
    const [rollbackMode, setRollbackMode] = useState<'smart' | 'manual'>('smart');
    const [rollbackPlan, setRollbackPlan] = useState('');
    const [loadingPlan, setLoadingPlan] = useState(false);
    const [processingRollback, setProcessingRollback] = useState(false);

    useEffect(() => {
        fetchVersions();
    }, [pipelineTarget]);

    useEffect(() => {
        if (rollbackModalOpen && rollbackMode === 'smart' && selectedVersion) {
            fetchRollbackPlan();
        }
    }, [rollbackModalOpen, rollbackMode, selectedVersion]);

    const fetchVersions = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/pipelines/${pipelineTarget}/versions`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setVersions(data.versions || []);
            }
        } catch (e) {
            console.error("Failed to fetch versions", e);
        } finally {
            setLoading(false);
        }
    };

    const fetchRollbackPlan = async () => {
        setLoadingPlan(true);
        try {
            const res = await fetch(`${API_URL}/api/pipelines/${pipelineTarget}/rollback-plan`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                // Format the JSON plan to YAML-like string (or just JSON if easy)
                // Ideally this returns YAML string. The API returns JSON object "plan".
                // I'll simple JSON.stringify for now as the "YAML". 
                // A real app would use 'js-yaml.dump'.
                setRollbackPlan(JSON.stringify(data.plan, null, 2));
            } else {
                setRollbackPlan("Error fetching plan.");
            }
        } catch (e) {
            setRollbackPlan("Error fetching plan.");
        } finally {
            setLoadingPlan(false);
        }
    };

    const handleDelete = async (filename: string) => {
        if (!await confirm({
            title: `Delete Version?`,
            message: `Are you sure you want to delete ${filename}?`,
            confirmText: "Delete",
            isDangerous: true
        })) return;
        try {
            const res = await fetch(`${API_URL}/api/pipelines/${pipelineTarget}/versions/${filename}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setMessage({ type: 'success', text: 'Version deleted' });
                fetchVersions();
            } else {
                throw new Error("Failed to delete");
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Failed to delete version' });
        }
    };

    const handleDownload = (filename: string) => {
        fetch(`${API_URL}/api/pipelines/${pipelineTarget}/versions/${filename}/download`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.blob())
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
            })
            .catch(() => setMessage({ type: 'error', text: 'Download failed' }));
    };

    const initiateRollback = (filename: string) => {
        setSelectedVersion(filename);
        setRollbackMode('smart'); // Default
        setRollbackModalOpen(true);
    };

    const confirmRollback = async () => {
        setProcessingRollback(true);
        try {
            const body: any = { version: selectedVersion };
            if (rollbackMode === 'smart') {
                body.smartRollbackYaml = rollbackPlan;
            }

            const res = await fetch(`${API_URL}/api/pipelines/${pipelineTarget}/rollback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'Rollback initiated! Check History.' });
                setRollbackModalOpen(false);
            } else {
                throw new Error("Failed to initiate");
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Failed to initiate rollback' });
        } finally {
            setProcessingRollback(false);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="h-full flex flex-col p-4">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-emerald-500" />
                Saved Versions
                <span className="text-xs font-normal text-slate-500 ml-2">(Max 10 / 1GB)</span>
            </h3>

            {message && (
                <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-bold ${message.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {message.text}
                </div>
            )}

            <div className="flex-1 overflow-auto border border-slate-700 rounded-lg bg-slate-900/50">
                <table className="w-full text-left text-sm text-slate-400">
                    <thead className="bg-slate-800 text-slate-200 uppercase font-bold text-xs sticky top-0">
                        <tr>
                            <th className="px-4 py-3">Version File</th>
                            <th className="px-4 py-3">Size</th>
                            <th className="px-4 py-3">Created</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {loading ? (
                            <tr><td colSpan={4} className="p-4 text-center">Loading versions...</td></tr>
                        ) : versions.length === 0 ? (
                            <tr><td colSpan={4} className="p-8 text-center text-slate-500">No archived versions found.</td></tr>
                        ) : (
                            versions.map((ver) => (
                                <tr key={ver.name} className="hover:bg-slate-800/50 transition-colors">
                                    <td className="px-4 py-3 font-mono text-white">{ver.name}</td>
                                    <td className="px-4 py-3">{formatSize(ver.size)}</td>
                                    <td className="px-4 py-3">{format(new Date(ver.modified), "MMM d, yyyy HH:mm")}</td>
                                    <td className="px-4 py-3 text-right flex justify-end gap-2">
                                        <button
                                            onClick={() => initiateRollback(ver.name)}
                                            className="p-1.5 text-blue-400 hover:bg-blue-900/30 rounded transition-colors"
                                            title="Restore / Rollback"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDownload(ver.name)}
                                            className="p-1.5 text-emerald-400 hover:bg-emerald-900/30 rounded transition-colors"
                                            title="Download Artifact"
                                        >
                                            <Download className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(ver.name)}
                                            className="p-1.5 text-red-400 hover:bg-red-900/30 rounded transition-colors"
                                            title="Delete Version"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Rollback Modal Overlay */}
            {rollbackModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                        <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <RotateCcw className="w-5 h-5 text-blue-500" />
                                Rollback to {selectedVersion}
                            </h3>
                            <button onClick={() => setRollbackModalOpen(false)} className="text-slate-400 hover:text-white">
                                <Trash2 className="w-5 h-5 rotate-45" /> {/* Close icon hack or import X */}
                            </button>
                        </div>

                        <div className="p-6 flex-1 overflow-auto">
                            <div className="mb-6">
                                <label className="text-sm font-bold text-slate-300 mb-2 block">Restoration Mode</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <div
                                        onClick={() => setRollbackMode('smart')}
                                        className={`cursor-pointer p-4 rounded-lg border-2 transition-all ${rollbackMode === 'smart' ? 'border-blue-500 bg-blue-900/20' : 'border-slate-700 hover:border-slate-600'}`}
                                    >
                                        <div className="font-bold text-white flex items-center gap-2 mb-1">
                                            <FileCode className="w-4 h-4" /> Smart Rollback
                                        </div>
                                        <p className="text-xs text-slate-400">Analyzes pipeline and skips build steps. Deploys using existing artifact assets.</p>
                                    </div>

                                    <div
                                        onClick={() => setRollbackMode('manual')}
                                        className={`cursor-pointer p-4 rounded-lg border-2 transition-all ${rollbackMode === 'manual' ? 'border-orange-500 bg-orange-900/20' : 'border-slate-700 hover:border-slate-600'}`}
                                    >
                                        <div className="font-bold text-white flex items-center gap-2 mb-1">
                                            <RefreshCw className="w-4 h-4" /> Full Redeploy
                                        </div>
                                        <p className="text-xs text-slate-400">Runs the full pipeline using the old code. Re-builds everything from scratch.</p>
                                    </div>
                                </div>
                            </div>

                            {rollbackMode === 'smart' && (
                                <div className="mb-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-sm font-bold text-slate-300">Generated Rollback Plan (YAML/JSON)</label>
                                        {loadingPlan && <span className="text-xs text-blue-400 animate-pulse">Generating plan...</span>}
                                    </div>
                                    <div className="relative">
                                        <textarea
                                            value={rollbackPlan}
                                            onChange={(e) => setRollbackPlan(e.target.value)}
                                            className="w-full h-64 bg-black border border-slate-700 rounded-md p-3 font-mono text-xs text-emerald-300 leading-relaxed focus:outline-none focus:border-blue-500"
                                        />
                                        <div className="absolute top-2 right-2 text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-400">
                                            Editable
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3 text-yellow-500" />
                                        Review the plan above. Steps involving builds/tests should be absent.
                                    </p>
                                </div>
                            )}

                            {rollbackMode === 'manual' && (
                                <div className="p-4 bg-orange-900/20 border border-orange-500/30 rounded-lg text-sm text-orange-200">
                                    <p>Caution: This will run the standard pipeline defined for this target, but applied to the restored workspace code. It may overwite newer build artifacts like Docker tags if not carefully versioned.</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3 rounded-b-xl">
                            <button
                                onClick={() => setRollbackModalOpen(false)}
                                className="px-4 py-2 rounded-lg text-slate-300 hover:text-white font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmRollback}
                                disabled={processingRollback}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg flex items-center gap-2 transition-all"
                            >
                                {processingRollback ? 'Initiating...' : 'Confirm & Execute'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VersionsTab;
