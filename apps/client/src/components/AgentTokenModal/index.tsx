import React, { useState, useEffect } from 'react';
import { X, Copy, Plus, Trash2, Key, Check, ShieldAlert } from 'lucide-react';
import { format } from "date-fns";
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import API_URL from '../../config/api';

interface AgentTokenModalProps {
    onClose: () => void;
}

interface AgentToken {
    id: number;
    name: string;
    token: string;
    created_at: string;
    last_used_at: string | null;
    scopes: string[];
}

const AgentTokenModal: React.FC<AgentTokenModalProps> = ({ onClose }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();

    const [tokens, setTokens] = useState<AgentToken[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [newTokenName, setNewTokenName] = useState("");
    const [createdToken, setCreatedToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const loadTokens = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/agent-tokens`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Failed to load tokens");
            const data = await res.json();
            setTokens(data.tokens || []);
        } catch (e) {
            console.error(e);
            setError("Failed to load tokens");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTokens();
    }, []);

    const createToken = async () => {
        if (!newTokenName.trim()) return;
        setLoading(true);
        setError(null);
        setCreatedToken(null);
        try {
            const res = await fetch(`${API_URL}/api/agent-tokens`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ name: newTokenName })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to create token");

            setCreatedToken(data.token);
            setNewTokenName("");
            loadTokens();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const deleteToken = async (id: number) => {
        if (!await confirm({
            title: "Revoke Token?",
            message: "Any agent using this token will lose access immediately. This action cannot be undone.",
            confirmText: "Revoke",
            isDangerous: true
        })) return;

        try {
            await fetch(`${API_URL}/api/agent-tokens/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            loadTokens();
        } catch (e) {
            setError("Failed to revoke token");
        }
    };

    const copyToken = () => {
        if (createdToken) {
            navigator.clipboard.writeText(createdToken);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#1e1e1e] rounded-xl border border-slate-700 shadow-2xl w-[600px] max-h-[85vh] flex flex-col">
                <div className="flex justify-between items-center p-4 border-b border-slate-700">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Key className="w-5 h-5 text-purple-400" />
                        Agent Access Tokens
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 bg-slate-900/50 border-b border-slate-800">
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-400 mb-1">Generate New Token</label>
                            <input
                                type="text"
                                placeholder="Token Name (e.g. Claude Code)"
                                className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 text-sm text-white focus:outline-none focus:border-purple-500"
                                value={newTokenName}
                                onChange={(e) => setNewTokenName(e.target.value)}
                            />
                        </div>
                        <button
                            onClick={createToken}
                            disabled={loading || !newTokenName.trim()}
                            className="mt-6 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {loading ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Plus className="w-4 h-4" />}
                            Generate
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-md text-sm flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    {createdToken && (
                        <div className="bg-emerald-900/20 border border-emerald-500/50 rounded-lg p-4 animate-in fade-in slide-in-from-top-2">
                            <h3 className="text-emerald-400 font-bold text-sm mb-2 flex items-center gap-2">
                                <Check className="w-4 h-4" />
                                Token Generated Successfully
                            </h3>
                            <p className="text-xs text-slate-400 mb-3">
                                Copy this token now. It will not be shown again.
                            </p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 bg-black/50 p-2 rounded border border-emerald-500/30 text-emerald-100 font-mono text-xs break-all">
                                    {createdToken}
                                </code>
                                <button
                                    onClick={copyToken}
                                    className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
                                >
                                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )}

                    <div>
                        <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Active Tokens</h3>
                        <div className="space-y-2">
                            {tokens.length === 0 ? (
                                <p className="text-slate-500 text-sm text-center py-4">No active tokens found.</p>
                            ) : (
                                tokens.map(t => (
                                    <div key={t.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 flex items-center justify-between group hover:border-slate-600 transition-colors">
                                        <div>
                                            <div className="font-medium text-slate-200">{t.name}</div>
                                            <div className="text-xs text-slate-500 mt-1">
                                                Created: {format(new Date(t.created_at), "MMM d, yyyy")} •
                                                Last Used: {t.last_used_at ? format(new Date(t.last_used_at), "MMM d HH:mm") : 'Never'}
                                            </div>
                                            <div className="flex gap-1 mt-2">
                                                {t.scopes.map(s => (
                                                    <span key={s} className="px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-600">{s}</span>
                                                ))}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => deleteToken(t.id)}
                                            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AgentTokenModal;
