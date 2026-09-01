import React from 'react';
import { AlertTriangle, Database, Shield } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useConfirm } from '../../../contexts/ConfirmationContext';
import { useToast } from '../../../contexts/ToastContext';

import API_URL from '../../../config/api';

const SystemTab: React.FC = () => {
    const { token, isAdmin, logout } = useAuth();
    const { confirm } = useConfirm();
    const toast = useToast();

    if (!isAdmin) {
        return (
            <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 text-center text-slate-400">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>You do not have permission to view system settings.</p>
            </div>
        );
    }

    const clearHistory = async () => {
        if (!await confirm({
            title: "Clear Global History?",
            message: "This will globally delete ALL build history database records. This action cannot be undone.",
            confirmText: "Clear All",
            isDangerous: true
        })) return;
        try {
            const res = await fetch(`${API_URL}/api/builds/history`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) toast.success("Global build history cleared.");
            else toast.error("Failed to clear history.");
        } catch (e) {
            console.error(e);
            console.error(e);
            toast.error("Error clearing history");
        }
    };

    const performReset = async (mode: string, label: string) => {
        const isFactory = mode === 'factory';
        // Confirm message moved inline to useConfirm call

        if (!await confirm({
            title: isFactory ? "Factory Reset?" : `Reset ${label}?`,
            message: isFactory
                ? "WARNING: FACTORY RESET\n\nThis will DELETE EVERYTHING (Pipelines, Configs, Users, Data).\nThis cannot be undone."
                : `Are you sure you want to reset ${label}?`,
            confirmText: isFactory ? "NUKE EVERYTHING" : "Reset",
            isDangerous: true
        })) return;

        try {
            const res = await fetch(`${API_URL}/api/system/reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ mode })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(`Success: ${data.message || 'Reset completed.'}. Please restart the server.`);
                if (mode === 'users' || mode === 'factory' || mode === 'smart') {
                    logout(); // Explicitly clear session
                    // Small delay to allow logout state to propagate or toast to show? 
                    // No, logout clears local storage and context updates.
                    // Reload will then redirect to login.
                    setTimeout(() => window.location.reload(), 1000);
                }
            } else {
                toast.error(`Failed: ${data.error}`);
            }
        } catch (e) {
            console.error(e);
            toast.error("Error performing reset");
        }
    };

    const [mfaEnforced, setMfaEnforced] = React.useState(false);

    React.useEffect(() => {
        if (isAdmin) {
            fetch(`${API_URL}/api/settings/security`, {
                headers: { Authorization: `Bearer ${token}` }
            })
                .then(res => res.json())
                .then(data => setMfaEnforced(data.mfa_enforced || false))
                .catch(err => console.error("Failed to fetch security settings", err));
        }
    }, [isAdmin, token]);

    const toggleMfaEnforcement = async () => {
        const newValue = !mfaEnforced;

        // Optimistic update? No, wait for confirmation
        try {
            const res = await fetch(`${API_URL}/api/settings/security`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ mfa_enforced: newValue })
            });

            const data = await res.json();

            if (res.ok) {
                setMfaEnforced(newValue);
                toast.success(`MFA Enforcement ${newValue ? 'Enabled' : 'Disabled'}`);
            } else {
                toast.error(data.error || "Failed to update security settings");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error updating security settings");
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Security Policies */}
            <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700">
                <h2 className="text-xl font-semibold mb-6 text-emerald-400 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Security Policies
                </h2>

                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                    <div>
                        <h3 className="font-bold text-slate-200 text-lg">Enforce MFA for All Users</h3>
                        <p className="text-slate-400 text-sm">
                            Require all users to set up Multi-Factor Authentication to access the system.
                            <br />
                            <span className="text-yellow-500/80 text-xs">Note: You must have MFA enabled on your own admin account first.</span>
                        </p>
                    </div>

                    <button
                        onClick={toggleMfaEnforcement}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${mfaEnforced ? 'bg-emerald-500' : 'bg-slate-700'}`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mfaEnforced ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                    </button>
                </div>
            </div>

            <div className="bg-red-900/10 p-6 rounded-xl border border-red-900/30">
                <h2 className="text-xl font-semibold mb-6 text-red-400 flex items-center gap-2">
                    <Database className="w-5 h-5" />
                    System Maintenance
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Primary Options */}
                    <div className="col-span-1 md:col-span-2 p-4 bg-emerald-900/20 rounded-lg border border-emerald-500/30 flex items-center justify-between">
                        <div>
                            <h3 className="font-bold text-emerald-400 text-lg">Smart Reset (Recommended)</h3>
                            <p className="text-emerald-200/60 text-sm">
                                Clears Users, Plugins, Logs, Build History. <br />
                                <span className="font-semibold text-emerald-300">Preserves Pipeline Configs (YAML, Resources, .env)</span>
                            </p>
                        </div>
                        <button
                            onClick={() => performReset('smart', 'Smart Reset')}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-emerald-900/20 transition-all"
                        >
                            Smart Reset
                        </button>
                    </div>

                    <div className="col-span-1 md:col-span-2 p-4 bg-red-950/40 rounded-lg border border-red-600/30 flex items-center justify-between">
                        <div>
                            <h3 className="font-bold text-red-500 text-lg flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5" /> Factory Reset
                            </h3>
                            <p className="text-red-300/60 text-sm">
                                NUKE EVERYTHING. Deletes all pipelines, configs, users, and data.
                            </p>
                        </div>
                        <button
                            onClick={() => performReset('factory', 'Factory Reset')}
                            className="bg-red-600 hover:bg-red-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-red-900/20 transition-all"
                        >
                            NUKE EVERYTHING
                        </button>
                    </div>

                    {/* Granular Options */}
                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-slate-200">Reset Pipelines Only</h3>
                            <p className="text-xs text-slate-400">Deletes all pipeline definitions</p>
                        </div>
                        <button onClick={() => performReset('pipelines', 'Pipelines')} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded border border-slate-600">Reset</button>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-slate-200">Reset Logs Only</h3>
                            <p className="text-xs text-slate-400">Clears app logs</p>
                        </div>
                        <button onClick={() => performReset('logs', 'Logs')} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded border border-slate-600">Reset</button>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-slate-200">Reset Users/DB Only</h3>
                            <p className="text-xs text-slate-400">Deletes main database</p>
                        </div>
                        <button onClick={() => performReset('users', 'Users/DB')} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded border border-slate-600">Reset</button>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-slate-200">Reset Plugins Only</h3>
                            <p className="text-xs text-slate-400">Reinstalls plugins next boot</p>
                        </div>
                        <button onClick={() => performReset('plugins', 'Plugins')} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded border border-slate-600">Reset</button>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-slate-200">Reset Claude Only</h3>
                            <p className="text-xs text-slate-400">Clears AI sandbox</p>
                        </div>
                        <button onClick={() => performReset('claude', 'Claude Sandbox')} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded border border-slate-600">Reset</button>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center justify-between opacity-50">
                        <div>
                            <h3 className="font-medium text-slate-200">Global Build History</h3>
                            <p className="text-xs text-slate-400">Use API endpoint or Smart Reset</p>
                        </div>
                        <button onClick={clearHistory} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded border border-slate-600">Clear</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SystemTab;
