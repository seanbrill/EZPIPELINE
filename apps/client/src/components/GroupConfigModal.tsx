import React, { useState, useEffect, useCallback } from 'react';
import { X, Key, File as FileIcon, FolderTree } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmationContext';
import { useToast } from '../contexts/ToastContext';
import EnvManager from './Shared/EnvManager';
import ResourceManager from './Shared/ResourceManager';
import API_URL from '../config/api';

interface Props {
    group: string;
    onClose: () => void;
}

/**
 * A group's environment and resources, from the dashboard.
 *
 * The same two things the Settings page exposes, reachable from where you are
 * actually looking at the group. Settings is the right home for the full list
 * across every scope; this is for "why can this pipeline not see the
 * subscription id", which is a question you ask with the group in front of you.
 */
const GroupConfigModal: React.FC<Props> = ({ group, onClose }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();
    const toast = useToast();
    const [tab, setTab] = useState<'env' | 'resources'>('env');
    const [vars, setVars] = useState<Array<{ key: string; value: string }>>([]);
    const g = encodeURIComponent(group);

    const fetchVars = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${API_URL}/api/group-env/${g}/keys-with-values`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setVars(data.variables || []);
        } catch {
            toast.error('Could not load this group\'s variables');
            setVars([]);
        }
    }, [token, g]);

    useEffect(() => { fetchVars(); }, [fetchVars]);

    const request = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(`${API_URL}/api/group-env/${g}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || 'Failed');
        }
        await fetchVars();
    };

    const tabBtn = (id: 'env' | 'resources', label: string, Icon: typeof Key) => (
        <button
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors border ${
                tab === id
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
        >
            <Icon className="w-4 h-4" />
            {label}
        </button>
    );

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-700">
                    <div>
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                            <FolderTree className="w-5 h-5 text-emerald-500" />
                            {group}
                        </h2>
                        <p className="text-xs text-slate-400 mt-1">
                            Applies to every pipeline in this group, including those in folders beneath it.
                            More specific always wins: instance, then group, then the pipeline's own.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white p-2 rounded-lg hover:bg-slate-800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex items-center gap-2 px-5 pt-4">
                    {tabBtn('env', 'Environment', Key)}
                    {tabBtn('resources', 'Resources', FileIcon)}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-5 custom-scrollbar">
                    {tab === 'env' ? (
                        <div className="border border-slate-700 rounded-xl overflow-hidden h-[50vh]">
                            <EnvManager
                                variables={vars}
                                onAdd={async (key, val) => {
                                    try {
                                        await request('POST', '/set', { key, value: val });
                                        toast.success(`Set ${key} for ${group}`);
                                    } catch (e) { toast.error((e as Error).message); }
                                }}
                                onUpdate={async (originalKey, newKey, newValue) => {
                                    try {
                                        // A rename is a delete plus a set, in that
                                        // order so a failed set cannot leave both.
                                        if (originalKey !== newKey) {
                                            await request('DELETE', `/${encodeURIComponent(originalKey)}`);
                                        }
                                        await request('POST', '/set', { key: newKey, value: newValue });
                                        toast.success(`Updated ${newKey}`);
                                    } catch (e) { toast.error((e as Error).message); }
                                }}
                                onDelete={async (key) => {
                                    if (!await confirm({
                                        title: `Delete ${key}?`,
                                        message: `Every pipeline in ${group} loses this variable on its next run.`,
                                        confirmText: 'Delete',
                                        isDangerous: true
                                    })) return;
                                    try {
                                        await request('DELETE', `/${encodeURIComponent(key)}`);
                                        toast.success(`Deleted ${key}`);
                                    } catch (e) { toast.error((e as Error).message); }
                                }}
                            />
                        </div>
                    ) : (
                        <ResourceManager
                            scopeLabel={group}
                            listUrl={`${API_URL}/api/config/group-resources/${g}`}
                            uploadUrl={`${API_URL}/api/config/group-resources/${g}/upload`}
                            deleteUrl={(name) => `${API_URL}/api/config/group-resources/${g}/${encodeURIComponent(name)}`}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default GroupConfigModal;
