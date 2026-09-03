import React, { useState, useEffect } from 'react';
import { Key, Download, Loader2, Check, Shield } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';

import API_URL from '../../../config/api';

const PluginsTab: React.FC = () => {
    const { token } = useAuth();
    const [plugins, setPlugins] = useState<any[]>([]);
    const [installingPlugin, setInstallingPlugin] = useState<string | null>(null);
    const [installLogs, setInstallLogs] = useState<string>("");

    useEffect(() => {
        if (token) fetchPlugins();
    }, [token]);

    const fetchPlugins = async () => {
        try {
            const res = await fetch(`${API_URL}/api/plugins`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setPlugins(data.plugins || []);
        } catch (e) {
            console.error("Failed to fetch plugins");
        }
    };

    const installPlugin = async (pluginId: string) => {
        setInstallingPlugin(pluginId);
        setInstallLogs("Starting installation...\n");

        try {
            const res = await fetch(`${API_URL}/api/plugins/${pluginId}/install`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.body) throw new Error("No response body");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                setInstallLogs(prev => prev + text);
            }

            fetchPlugins();
        } catch (e) {
            setInstallLogs(prev => prev + `\nError: ${e}`);
        } finally {
            setInstallingPlugin(null);
        }
    };

    return (
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm animate-in fade-in duration-500">
            <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-purple-500" />
                Plugins & Integrations
            </h2>
            <p className="text-sm text-slate-400 mb-6">
                Extend functionality with official plugins.
            </p>

            <div className="space-y-4">
                {plugins.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 italic">No plugins available or loading...</div>
                ) : (
                    plugins.map(plugin => (
                        <div key={plugin.id} className="bg-slate-800/40 border border-slate-700 rounded-xl p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between hover:border-slate-600 transition-all">
                            <div className="flex-1">
                                <div className="flex items-center gap-3">
                                    <h3 className="font-bold text-white text-lg">{plugin.name}</h3>
                                    {plugin.isInstalled ? (
                                        <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-500/20 font-medium">
                                            <Check className="w-3 h-3" /> Installed {plugin.version && `v${plugin.version}`}
                                        </span>
                                    ) : (
                                        <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full border border-slate-600">
                                            Not Installed
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-slate-400 mt-2 leading-relaxed">{plugin.description}</p>
                                {plugin.id === 'claude-code' && !plugin.isInstalled && (
                                    <p className="text-xs text-yellow-500 mt-2 flex items-center gap-1 bg-yellow-500/10 p-2 rounded border border-yellow-500/20 inline-block">
                                        <Shield className="w-3 h-3" /> Requires 'claude' CLI to be available on server.
                                    </p>
                                )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                {plugin.isInstalled ? (
                                    <button className="px-4 py-2 bg-slate-800 text-slate-500 rounded-lg text-sm font-medium cursor-not-allowed border border-slate-700" disabled>
                                        Installed
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => installPlugin(plugin.id)}
                                        disabled={!!installingPlugin}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-lg ${installingPlugin === plugin.id
                                            ? 'bg-slate-700 text-slate-300'
                                            : 'bg-emerald-600 hover:bg-emerald-500 text-white hover:scale-105 active:scale-95 shadow-emerald-900/20'
                                            }`}
                                    >
                                        {installingPlugin === plugin.id ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" /> Installing...
                                            </>
                                        ) : (
                                            <>
                                                <Download className="w-4 h-4" /> Install Plugin
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}

                {/* Shown whenever there IS output, not only while a run is in
                    flight. It used to be gated on installingPlugin, which the
                    finally block clears the moment the install ends: the panel
                    unmounted and took every line with it, including the error.
                    A failure that takes two seconds looked exactly like
                    clicking the button and nothing happening. */}
                {installLogs && (
                    <div className="mt-6 bg-black rounded-xl border border-slate-800 p-4 font-mono text-xs text-green-400 h-48 overflow-y-auto whitespace-pre-wrap shadow-inner relative">
                        <div className="absolute top-2 right-2 flex items-center gap-2">
                            <span className="text-[10px] text-slate-600 uppercase font-bold">Installation Logs</span>
                            {!installingPlugin && (
                                <button
                                    onClick={() => setInstallLogs("")}
                                    className="text-[10px] text-slate-500 hover:text-slate-300 uppercase font-bold"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        {installLogs}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PluginsTab;
