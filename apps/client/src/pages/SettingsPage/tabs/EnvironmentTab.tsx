import React, { useState, useEffect } from 'react';
import { Key } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useConfirm } from '../../../contexts/ConfirmationContext';
import EnvManager from '../../../components/Shared/EnvManager';

import API_URL from '../../../config/api';

const EnvironmentTab: React.FC = () => {
    const { token } = useAuth();
    const { confirm } = useConfirm();

    const [globalEnvVars, setGlobalEnvVars] = useState<Array<{ key: string; value: string }>>([]);

    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        if (token) fetchGlobalEnvVars();
    }, [token]);

    const fetchGlobalEnvVars = async () => {
        try {
            const res = await fetch(`${API_URL}/api/global-env/keys-with-values`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setGlobalEnvVars(data.variables || []);
        } catch (e) {
            console.error("Failed to fetch global env vars");
        }
    };



    const handleUpdate = async (originalKey: string, newKey: string, newValue: string) => {
        // If key changed, we need to delete old and create new (or use specific rename API if available)
        // For now, let's assume update only updates value for same key, or handles rename via delete+add logic if needed.
        // Actually the API /api/global-env/set handles Insert or Update on Duplicate Key usually.
        // But if key changes, we need to delete the old one.

        if (originalKey !== newKey) {
            // Rename scenario
            if (!await confirm({ title: 'Rename Variable?', message: 'Changing the key will delete the old variable and create a new one.', confirmText: 'Rename' })) return;
            await deleteGlobalEnvVar(originalKey);
        }

        try {
            const res = await fetch(`${API_URL}/api/global-env/set`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ key: newKey, value: newValue })
            });
            if (res.ok) {
                setMessage({ type: 'success', text: "Variable updated successfully" });
                fetchGlobalEnvVars();
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.error || "Failed to update variable" });
            }
        } catch (e) {
            setMessage({ type: 'error', text: "Error updating variable" });
        }
        setTimeout(() => setMessage(null), 3000);
    };

    const deleteGlobalEnvVar = async (key: string) => {
        if (!await confirm({
            title: "Delete Variable?",
            message: `Delete global environment variable '${key}'?`,
            confirmText: "Delete",
            isDangerous: true
        })) return;

        try {
            const res = await fetch(`${API_URL}/api/global-env/${key}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setMessage({ type: 'success', text: "Variable deleted successfully" });
                fetchGlobalEnvVars();
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.error || "Failed to delete variable" });
            }
        } catch (e) {
            setMessage({ type: 'error', text: "Error deleting variable" });
        }
        setTimeout(() => setMessage(null), 3000);
    };

    return (
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm animate-in fade-in duration-500 h-[calc(100vh-200px)] flex flex-col">
            <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-emerald-500" />
                Global Environment Variables
            </h2>
            <p className="text-sm text-slate-400 mb-6 max-w-2xl">
                Define environment variables that will be available to <strong>all</strong> pipelines.
                Pipeline-specific variables with the same key will override these values.
            </p>

            {message && (
                <div className={`mb-4 p-3 rounded-lg text-sm font-medium border flex items-center gap-2 ${message.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                    {message.text}
                </div>
            )}

            <div className="flex-1 min-h-0 border border-slate-700 rounded-xl overflow-hidden">
                <EnvManager
                    variables={globalEnvVars}
                    onAdd={async (key, val) => {
                        try {
                            const res = await fetch(`${API_URL}/api/global-env/set`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                body: JSON.stringify({ key, value: val })
                            });
                            if (res.ok) {
                                setMessage({ type: 'success', text: "Variable added successfully" });
                                fetchGlobalEnvVars();
                            } else {
                                const data = await res.json();
                                setMessage({ type: 'error', text: data.error || "Failed" });
                            }
                        } catch (e) { setMessage({ type: 'error', text: "Network error" }); }
                    }}
                    onUpdate={handleUpdate}
                    onDelete={deleteGlobalEnvVar}
                />
            </div>
        </div>
    );
};



export default EnvironmentTab;
