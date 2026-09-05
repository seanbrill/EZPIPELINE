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

    // SCOPE. Instance-wide, or one group.
    //
    // Every notch.fm pipeline needs the same Azure subscription; every
    // FileFreak pipeline needs a different one. Instance-wide means the two
    // projects share credentials they have no business sharing, and
    // per-pipeline means copies that drift - and the copy that drifts is
    // always the one nobody is looking at.
    const [scope, setScope] = useState<string>('__global__');
    const [groups, setGroups] = useState<string[]>([]);
    const [groupEnvVars, setGroupEnvVars] = useState<Array<{ key: string; value: string }>>([]);

    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        if (token) { fetchGlobalEnvVars(); fetchGroups(); }
    }, [token]);

    useEffect(() => {
        if (token && scope !== '__global__') fetchGroupEnvVars(scope);
    }, [token, scope]);

    const fetchGroups = async () => {
        try {
            const res = await fetch(`${API_URL}/api/pipelines`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            const list: string[] = Array.isArray(data) ? data : (data.pipelines ?? []);
            const found = new Set<string>();
            for (const p of list as Array<{ group?: string }>) {
                if (p.group && p.group !== 'General') found.add(p.group);
            }
            setGroups([...found].sort());
        } catch (e) {
            console.error("Failed to fetch groups");
        }
    };

    const fetchGroupEnvVars = async (group: string) => {
        try {
            const res = await fetch(`${API_URL}/api/group-env/${encodeURIComponent(group)}/keys-with-values`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setGroupEnvVars(data.variables || []);
        } catch (e) {
            console.error("Failed to fetch group env vars");
        }
    };

    const groupRequest = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(`${API_URL}/api/group-env/${encodeURIComponent(scope)}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || 'Failed');
        }
        await fetchGroupEnvVars(scope);
    };

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
            <p className="text-sm text-slate-400 mb-4 max-w-2xl">
                {scope === '__global__' ? (
                    <>Variables available to <strong>every</strong> pipeline in this instance.</>
                ) : (
                    <>Variables available to every pipeline in <strong>{scope}</strong>, and to no other group.</>
                )}
                {' '}More specific always wins: instance, then group, then the pipeline's own file.
            </p>

            {/* Scope. A group's credentials should not be visible to another
                group's pipelines, and putting them instance-wide is exactly
                that - so the choice is made here rather than by convention. */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
                <button
                    onClick={() => setScope('__global__')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scope === '__global__'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'text-[var(--color-text-muted)] border border-[var(--color-text-muted)]/25 hover:text-[var(--color-text)]'}`}
                >
                    All pipelines
                </button>
                {groups.map(g => (
                    <button
                        key={g}
                        onClick={() => setScope(g)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scope === g
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'text-[var(--color-text-muted)] border border-[var(--color-text-muted)]/25 hover:text-[var(--color-text)]'}`}
                    >
                        {g}
                    </button>
                ))}
            </div>

            {message && (
                <div className={`mb-4 p-3 rounded-lg text-sm font-medium border flex items-center gap-2 ${message.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                    {message.text}
                </div>
            )}

            <div className="flex-1 min-h-0 border border-slate-700 rounded-xl overflow-hidden">
                {scope !== '__global__' ? (
                    <EnvManager
                        variables={groupEnvVars}
                        onAdd={async (key, val) => {
                            try {
                                await groupRequest('POST', '/set', { key, value: val });
                                setMessage({ type: 'success', text: `Set ${key} for ${scope}` });
                            } catch (e) {
                                setMessage({ type: 'error', text: (e as Error).message });
                            }
                        }}
                        onUpdate={async (originalKey, newKey, newValue) => {
                            try {
                                // A rename is a delete plus a set. Done in that
                                // order so a failed set does not leave both.
                                if (originalKey !== newKey) await groupRequest('DELETE', `/${encodeURIComponent(originalKey)}`);
                                await groupRequest('POST', '/set', { key: newKey, value: newValue });
                                setMessage({ type: 'success', text: `Updated ${newKey}` });
                            } catch (e) {
                                setMessage({ type: 'error', text: (e as Error).message });
                            }
                        }}
                        onDelete={async (key) => {
                            if (!await confirm({
                                title: `Delete ${key}?`,
                                message: `Every pipeline in ${scope} loses this variable on its next run.`,
                                confirmText: 'Delete',
                            })) return;
                            try {
                                await groupRequest('DELETE', `/${encodeURIComponent(key)}`);
                                setMessage({ type: 'success', text: `Deleted ${key}` });
                            } catch (e) {
                                setMessage({ type: 'error', text: (e as Error).message });
                            }
                        }}
                    />
                ) : (
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
                )}
            </div>
        </div>
    );
};



export default EnvironmentTab;
