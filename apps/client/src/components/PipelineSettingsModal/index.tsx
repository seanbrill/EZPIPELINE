import React, { useState, useEffect } from 'react';
import { X, Save, FileCode, Database, RotateCcw, Clock, CheckCircle2, XCircle, Terminal, Trash2, File, Play, Package, AlertTriangle } from 'lucide-react';
import ResourceTab from './ResourceTab';
import StepsTab from './StepsTab';
import EnvironmentTab from './EnvironmentTab';
import ScheduleTab from './ScheduleTab';
import VersionsTab from './VersionsTab';
import { format } from "date-fns";
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import API_URL from '../../config/api';

interface Pipeline {
    id: string;
    appName: string;
    description: string;
    version: string;
    filePath?: string;
    group?: string;
    env?: string;
    author?: string;
    permissions?: {
        canEditYaml: boolean;
        canEditEnv: boolean;
        canViewResources: boolean;
        canUseClaude: boolean;
        canUseTerminal: boolean;
        canRun: boolean;
    };
}

interface PipelineSettingsModalProps {
    pipeline: Pipeline;
    onClose: () => void;
    onUpdate: () => void;
    availableGroups: string[];
    /** Open straight onto a tab, e.g. the dashboard's Logs button. */
    openTab?: 'steps' | 'environment' | 'resources' | 'schedule' | 'history' | 'versions';
    /** With openTab='history', select this run and show its logs immediately. */
    openBuildId?: string;
}

const PipelineSettingsModal: React.FC<PipelineSettingsModalProps> = ({ pipeline, onClose, onUpdate, openTab, openBuildId }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();

    // Determine available tabs based on permissions
    const permissions = pipeline.permissions || {
        canEditYaml: true,
        canEditEnv: true,
        canViewResources: true,
        canUseClaude: true,
        canUseTerminal: true,
        canRun: true
    }; // Fallback to full access for backward compatibility if API doesn't return permissions

    // An explicit request wins over the permission default: arriving from the
    // dashboard's Logs button should land on the logs, not on the YAML editor.
    const initialTab = openTab ?? (permissions.canEditYaml ? 'steps' : 'history');
    const [activeTab, setActiveTab] = useState<'steps' | 'environment' | 'resources' | 'schedule' | 'history' | 'versions'>(initialTab);

    // Safety check: ensure activeTab is actually allowed, if not switch to history
    useEffect(() => {
        if (activeTab === 'steps' && !permissions.canEditYaml) setActiveTab('history');
        if (activeTab === 'environment' && !permissions.canEditEnv) setActiveTab('history');
        if (activeTab === 'resources' && !permissions.canViewResources) setActiveTab('history');
    }, [pipeline, permissions]);

    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [resources, setResources] = useState<string[]>([]);
    const [localEnvVars, setLocalEnvVars] = useState<string[]>([]);
    const [globalEnvVars, setGlobalEnvVars] = useState<string[]>([]);

    // Keyboard shortcut for saving
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                if ((activeTab === 'steps' && permissions.canEditYaml) || (activeTab === 'environment' && permissions.canEditEnv)) {
                    saveContent();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab, content, pipeline, permissions]); // Dependencies important for saveContent closure

    // Load content when tab changes
    useEffect(() => {
        if (activeTab === 'history' || activeTab === 'schedule' || activeTab === 'resources' || activeTab === 'versions') return;

        // Clear content to prevent state leakage between tabs (e.g. showing steps in env tab)
        setContent('');

        loadContent();
        if (activeTab === 'steps' && permissions.canEditYaml) { // Only fetch if allowed
            fetchResources();
            fetchLocalEnvVars();
            fetchGlobalEnvVars();
        }
    }, [activeTab, pipeline]);

    const getEnvPath = () => {
        if (!pipeline.filePath) return `.env.${pipeline.env || pipeline.id} `;

        let relPath = pipeline.filePath;
        if (relPath.includes('/data/pipelines/')) {
            relPath = relPath.split('/data/pipelines/')[1];
        }

        const dir = relPath.substring(0, relPath.lastIndexOf('/'));
        // If it's a bundle (pipeline.yaml), use .env active in that dir
        if (relPath.endsWith('pipeline.yaml') || relPath.endsWith('.pipeline')) {
            return `${dir}/.env`;
        }

        // Otherwise use legacy naming relative to that dir
        const envPath = `${dir}/.env.${pipeline.env || pipeline.id}`;

        // Aggressive Safeguard: Never return a yaml file as env path
        // If for any reason we ended up with a .yaml path, strip it and force .env
        if (envPath.endsWith('.yaml') || envPath.endsWith('.yml')) {
            return `${dir}/.env`;
        }

        return envPath;
    };

    const fetchResources = async () => {
        if (!permissions.canViewResources) return;
        try {
            let dir = 'resources';
            if (pipeline.filePath) {
                const parts = pipeline.filePath.split('/');
                if (parts.length > 1) {
                    parts.pop(); // remove filename
                    dir = parts.join('/') + '/resources';
                }
            }
            // Encode path properly
            const res = await fetch(`${API_URL}/api/config/resources?type=yaml&path=${encodeURIComponent(dir)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setResources(data.files?.map((f: any) => f.name) || []);
            }
        } catch (e) {
            console.error("Failed to fetch resources", e);
        }
    };

    const fetchLocalEnvVars = async () => {
        try {
            const path = getEnvPath();
            // If we don't have editEnv, but we are here (meaning we have editYaml), we request keys only
            const keysOnly = !permissions.canEditEnv;

            const res = await fetch(`${API_URL}/api/config/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ type: 'env', path, keysOnly })
            });
            if (res.ok) {
                const data = await res.json();
                const vars = data.content
                    .split('\n')
                    .map((l: string) => l.trim())
                    .filter((l: string) => l && !l.startsWith('#') && l.includes('='))
                    .map((l: string) => l.split('=')[0]);
                setLocalEnvVars(vars);
            }
        } catch (e) {
            console.error("Failed to fetch env vars", e);
        }
    };

    const fetchGlobalEnvVars = async () => {
        try {
            const res = await fetch(`${API_URL}/api/global-env/keys`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setGlobalEnvVars(data.keys || []);
            }
        } catch (e) {
            console.error("Failed to fetch global env vars", e);
        }
    };

    const loadContent = async () => {
        setLoading(true);
        setMessage(null);
        try {
            // Determine path based on tab
            let path = '';
            let type: 'yaml' | 'env' = 'yaml';

            if (activeTab === 'steps') {
                if (!permissions.canEditYaml) throw new Error("Access denied to YAML");
                path = pipeline.filePath || '';
                if (path.includes('/data/pipelines/')) {
                    path = path.split('/data/pipelines/')[1];
                }
                if (!path) throw new Error("File path not available");
            } else if (activeTab === 'environment') {
                if (!permissions.canEditEnv) throw new Error("Access denied to Env");
                type = 'env';
                path = getEnvPath();
            }

            const res = await fetch(`${API_URL}/api/config/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ type, path })
            });

            if (!res.ok) {
                if (activeTab === 'environment') {
                    // Start with basic template if missing
                    setContent(`# Environment variables for ${pipeline.appName}\nAPP_ENV=production\n`);
                    return;
                }
                throw new Error("Failed to load");
            }

            const data = await res.json();
            setContent(data.content);
        } catch (e) {
            console.error(e);
            if (activeTab !== 'environment') setMessage({ type: 'error', text: 'Failed to load content' });
        } finally {
            setLoading(false);
        }
    };

    const saveContent = async (newContent?: string) => {
        const contentToSave = newContent !== undefined ? newContent : content;
        setLoading(true);
        try {
            let path = '';
            let type: 'yaml' | 'env' = 'yaml';

            if (activeTab === 'steps') {
                if (!permissions.canEditYaml) return;
                path = pipeline.filePath!;
            } else {
                if (!permissions.canEditEnv) return;
                type = 'env';
                path = getEnvPath();
            }

            await fetch(`${API_URL}/api/config/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ type, path, content: contentToSave })
            });
            setContent(contentToSave); // Update local state if successful
            setMessage({ type: 'success', text: 'Saved successfully' });

            // Trigger parent update
            onUpdate();

            // Re-fetch env vars if we saved env to update autocomplete
            if (activeTab === 'environment') {
                fetchLocalEnvVars();
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Failed to save' });
        } finally {
            setLoading(false);
            setTimeout(() => setMessage(null), 3000);
        }
    };

    const runPipeline = async () => {
        if (!permissions.canRun) return;

        if (!await confirm({
            title: `Run ${pipeline.appName}?`,
            message: `Are you sure you want to trigger a manual run for ${pipeline.appName}?`,
            confirmText: "Run Pipeline"
        })) return;
        try {
            const res = await fetch(`${API_URL}/api/run-pipeline`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ target: pipeline.id })
            });
            if (res.ok) {
                setMessage({ type: 'success', text: 'Pipeline started!' });
                setActiveTab('history');
            } else {
                throw new Error("Failed to start");
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Failed to run pipeline' });
        }
    };

    const canSave = (activeTab === 'steps' && permissions.canEditYaml) || (activeTab === 'environment' && permissions.canEditEnv);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-2">
            {/* Nearly the whole window. The thing being edited is a pipeline
                step, which is a shell script forty lines long, and every pixel
                given back to the page behind is a pixel not showing one. The
                backdrop keeps a thin margin so it still reads as a layer over
                the dashboard rather than a new page. */}
            <div className="bg-[#1e1e1e] rounded-xl border border-slate-700 shadow-2xl w-[97vw] h-[95vh] flex flex-col">
                <div className="flex justify-between items-center p-4 border-b border-slate-700">
                    <div>
                        <h2 className="text-xl font-bold text-white">{pipeline.appName}</h2>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                            <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">v{pipeline.version || '1.0.0'}</span>
                            {pipeline.group && <span className="opacity-50">in {pipeline.group}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {canSave && (
                            <button
                                onClick={() => saveContent()}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-lg flex items-center gap-2 transition-all hover:scale-105"
                                title="Save Changes (Cmd/Ctrl + S)"
                            >
                                <Save className="w-4 h-4" /> {loading ? 'Saving...' : 'Save'}
                            </button>
                        )}
                        <div className="w-px h-6 bg-slate-700 mx-1"></div>
                        {permissions.canRun && (
                            <button
                                onClick={runPipeline}
                                disabled={loading}
                                className={`bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-lg flex items-center gap-2 transition-all hover:scale-105 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <Play className="w-3.5 h-3.5 fill-current" /> Run
                            </button>
                        )}
                        <div className="w-px h-6 bg-slate-700 mx-1"></div>
                        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Tab Navigation - Reordered */}
                <div className="flex border-b border-slate-700 bg-[var(--color-surface)] overflow-x-auto">
                    {permissions.canEditYaml && (
                        <button
                            onClick={() => setActiveTab('steps')}
                            className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'steps' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
                        >
                            <FileCode className="w-4 h-4" /> Code (YAML)
                        </button>
                    )}
                    {permissions.canEditEnv && (
                        <button
                            onClick={() => setActiveTab('environment')}
                            className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'environment' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
                        >
                            <Database className="w-4 h-4" /> Environment
                        </button>
                    )}
                    {permissions.canViewResources && (
                        <button
                            onClick={() => setActiveTab('resources')}
                            className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'resources' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
                        >
                            <File className="w-4 h-4" /> Resources
                        </button>
                    )}
                    <button
                        onClick={() => setActiveTab('schedule')}
                        className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'schedule' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
                    >
                        <Clock className="w-4 h-4" /> Schedule
                    </button>
                    <button
                        onClick={() => setActiveTab('versions')}
                        className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'versions' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
                    >
                        <Package className="w-4 h-4" /> Versions
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'history' ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
                    >
                        <RotateCcw className="w-4 h-4" /> History
                    </button>
                </div>

                <div className="flex-1 overflow-hidden relative flex flex-col">
                    {loading && (
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
                        </div>
                    )}

                    {activeTab === 'steps' ? (
                        <div className="flex-1 flex flex-col min-h-0 relative">
                            {/* Removed local save buttons */}
                            <StepsTab
                                content={content}
                                onChange={(newContent) => setContent(newContent)}
                                resources={resources}
                                envVars={localEnvVars}
                                globalEnvVars={globalEnvVars}
                            />
                        </div>
                    ) : activeTab === 'environment' ? (
                        <div className="flex-1 flex flex-col min-h-0 relative">
                            {/* Removed local save buttons */}
                            <EnvironmentTab
                                content={content}
                                onChange={(newContent) => setContent(newContent)}
                                globalVars={globalEnvVars}
                            />
                        </div>
                    ) : activeTab === 'resources' ? (
                        <div className="flex-1 p-4 h-full overflow-hidden">
                            <ResourceTab pipelinePath={pipeline.filePath} />
                        </div>
                    ) : activeTab === 'schedule' ? (
                        <div className="flex-1 p-4 h-full overflow-hidden">
                            <ScheduleTab pipelineTarget={pipeline.id} />
                        </div>
                    ) : activeTab === 'versions' ? (
                        <div className="flex-1 p-0 h-full overflow-hidden">
                            <VersionsTab pipelineTarget={pipeline.id} />
                        </div>
                    ) : activeTab === 'history' ? (
                        <div className="flex-1 p-4 h-full overflow-hidden">
                            <HistoryView pipelineName={pipeline.id} initialBuildId={openBuildId} />
                        </div>
                    ) : null}

                    {message && (
                        <div className={`absolute bottom-6 right-6 px-4 py-2 rounded-lg shadow-lg text-sm font-bold z-50 animate-in slide-in-from-bottom-2 fade-in ${message.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-red-500/20 text-red-400 border border-red-500/50'
                            }`}>
                            {message.text}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const HistoryView = ({ pipelineName, initialBuildId }: { pipelineName: string; initialBuildId?: string }) => {
    const { confirm } = useConfirm();
    const [builds, setBuilds] = useState<any[]>([]);
    // Seeded from the caller, so the logs are already on screen rather than one
    // more click away after a click that was specifically asking for them.
    const [selectedBuildId, setSelectedBuildId] = useState<string | null>(initialBuildId ?? null);
    const [logs, setLogs] = useState<string[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    const loadHistory = () => {
        fetch(`${API_URL}/api/history/${pipelineName}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        })
            .then(res => res.json())
            .then(data => {
                // Newest first. NOT renumbered: see DashboardPage - numbering
                // by position capped the visible number at the page size and
                // made the same build change number as others arrived.
                const sorted = (data.builds || [])
                    .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
                setBuilds(sorted);
            });
    };

    useEffect(() => {
        loadHistory();
    }, [pipelineName]);

    useEffect(() => {
        if (!selectedBuildId) {
            setLogs([]);
            return;
        }
        setLoadingLogs(true);
        fetch(`${API_URL}/api/builds/${selectedBuildId}/logs`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        })
            .then(res => res.json())
            .then(data => {
                setLogs(data.logs || []);
                setLoadingLogs(false);
            });
    }, [selectedBuildId]);

    const clearHistory = async () => {
        if (!await confirm({
            title: "Clear All History?",
            message: "Are you sure you want to clear ALL build history for this pipeline? This cannot be undone.",
            confirmText: "Clear All",
            isDangerous: true
        })) return;
        try {
            await fetch(`${API_URL}/api/history/${pipelineName}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            loadHistory();
            setSelectedBuildId(null);
        } catch (e) {
            console.error("Failed to clear history", e);
        }
    };

    const deleteBuild = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!await confirm({
            title: "Delete Build?",
            message: "Are you sure you want to delete this build record?",
            confirmText: "Delete",
            isDangerous: true
        })) return;
        try {
            await fetch(`${API_URL}/api/builds/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            loadHistory();
            if (selectedBuildId === id) setSelectedBuildId(null);
        } catch (e) {
            console.error("Failed to delete build", e);
        }
    };

    return (
        <div className="flex h-full gap-4">
            <div className="w-1/3 border-r border-slate-700 pr-4 flex flex-col gap-2">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-white">Build History</h3>
                    {builds.length > 0 && (
                        <button
                            onClick={clearHistory}
                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
                        >
                            <Trash2 className="w-3 h-3" /> Clear All
                        </button>
                    )}
                </div>
                <div className="h-full overflow-y-auto pr-2 custom-scrollbar">
                    {builds.length === 0 && <p className="text-muted-foreground text-sm text-slate-500">No history found.</p>}
                    {builds.map(build => (
                        <div
                            key={build.id}
                            className={`p-3 rounded-md cursor-pointer text-sm border mb-2 group relative ${selectedBuildId === build.id ? "bg-slate-800 border-emerald-500" : "border-slate-800 hover:bg-slate-800"}`}
                            onClick={() => setSelectedBuildId(build.id)}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-slate-400 font-mono text-xs">#{build.buildNumber || (typeof build.id === 'string' ? build.id.substring(0, 8) : build.id)}</span>
                                {build.status === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                                {build.status === 'running' && <RotateCcw className="w-3 h-3 animate-spin text-blue-500" />}
                                {build.status === 'failed' && (
                                    build.steps?.some((s: any) => s.status === 'failed' && s.continueOnError) ?
                                        <AlertTriangle className="w-3 h-3 text-amber-500" /> : <XCircle className="w-3 h-3 text-red-500" />
                                )}
                                {build.status === 'error' && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                                <Clock className="w-3 h-3" />
                                {build.startTime ? format(new Date(build.startTime), "MMM d, HH:mm") : 'Unknown'}
                            </div>

                            {/* Delete Button - Absolute positioned */}
                            <button
                                onClick={(e) => deleteBuild(e, build.id)}
                                className="absolute right-2 bottom-2 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-slate-700/50 rounded"
                                title="Delete Build"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            <div className="w-2/3 flex flex-col">
                <h3 className="font-semibold mb-2 flex items-center gap-2 text-white"><Terminal className="w-4 h-4" /> Logs {selectedBuildId && <span className="text-xs text-slate-500 font-mono">({selectedBuildId})</span>}</h3>
                <div className="flex-1 bg-black/80 rounded-md border border-slate-700 p-4 font-mono text-xs overflow-y-auto whitespace-pre-wrap text-emerald-100 h-full custom-scrollbar">
                    {selectedBuildId ? (
                        loadingLogs ? "Loading logs..." : (
                            logs.length > 0 ? logs.join("\n") : "No logs available."
                        )
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-500">Select a build to view logs</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PipelineSettingsModal;
