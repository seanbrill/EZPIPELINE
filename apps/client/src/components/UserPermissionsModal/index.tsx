import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Shield, Eye, Play, FileCode, Settings, Zap, Terminal, Folder } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import API_URL from '../../config/api';

interface GranularPermission {
    target: string;
    canView: boolean;
    canRun: boolean;
    canEditYaml: boolean;
    canEditEnv: boolean;
    canUseClaude: boolean;
    canUseTerminal: boolean;
    canViewResources: boolean;
}

interface Pipeline {
    id: string;
    appName: string;
    group?: string;
}

interface User {
    id: number;
    username: string;
    email?: string;
    isAdmin?: boolean;
    canManageUsers?: boolean;
}

interface Props {
    user: User;
    onClose: () => void;
    onUpdate: () => void;
}

const UserPermissionsModal: React.FC<Props> = ({ user, onClose, onUpdate }) => {
    const { token } = useAuth();
    const toast = useToast();
    const [isAdmin, setIsAdmin] = useState(user.isAdmin ?? false);
    const [canManageUsers, setCanManageUsers] = useState(user.canManageUsers ?? false);
    const [email, setEmail] = useState(user.email || '');
    const [permissions, setPermissions] = useState<GranularPermission[]>([]);
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadData();
    }, [user.id]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Fetch user permissions
            const permsRes = await fetch(`${API_URL}/api/users/${user.id}/permissions`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const permsData = await permsRes.json();

            // Fetch available pipelines
            const pipelinesRes = await fetch(`${API_URL}/api/targets`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const pipelinesData = await pipelinesRes.json();

            setPermissions(permsData.permissions || []);
            setPipelines(pipelinesData.targets || []);
        } catch (e) {
            console.error('Failed to load permissions', e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);

            // Save permissions
            await fetch(`${API_URL}/api/users/${user.id}/permissions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ permissions })
            });

            // Update user details (admin, manage users, email)
            await fetch(`${API_URL}/api/users/${user.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    isAdmin,
                    canManageUsers,
                    email
                })
            });

            onUpdate();
            onClose();
            toast.success("User updated successfully");
        } catch (e) {
            console.error('Failed to save permissions', e);
            toast.error('Failed to update user');
        } finally {
            setSaving(false);
        }
    };

    const handleResetPermissions = async () => {
        if (!confirm("Are you sure you want to reset all permissions for this user? they will lose access to specific pipelines.")) return;

        try {
            setSaving(true);
            await fetch(`${API_URL}/api/users/${user.id}/permissions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ permissions: [] })
            });
            toast.success("Permissions reset successfully");
            loadData();
        } catch (e) {
            toast.error("Failed to reset permissions");
        } finally {
            setSaving(false);
        }
    };

    const getPermissionForPipeline = (pipeline: Pipeline): GranularPermission => {
        const targets = [
            `pipeline:${pipeline.id}`,
            pipeline.id,
            `pipeline:${pipeline.appName}`,
            pipeline.appName
        ];

        // Find existing permission matching any valid target variant (case-insensitive)
        const existing = permissions.find(p => p.target && targets.some(t =>
            p.target.toLowerCase() === t.toLowerCase()
        ));

        if (existing) return existing;

        // Default for new
        return {
            target: `pipeline:${pipeline.id}`,
            canView: false,
            canRun: false,
            canEditYaml: false,
            canEditEnv: false,
            canViewResources: false, // Added missing default
            canUseClaude: false,
            canUseTerminal: false
        };
    };

    const updatePermission = (pipeline: Pipeline, updates: Partial<GranularPermission>) => {
        // Find if we already have a record for this pipeline
        const current = getPermissionForPipeline(pipeline);
        const target = current.target; // Use existing target (Name or ID)

        const existingIndex = permissions.findIndex(p => p.target === target);

        if (existingIndex >= 0) {
            const newPerms = [...permissions];
            newPerms[existingIndex] = { ...newPerms[existingIndex], ...updates };
            setPermissions(newPerms);
        } else {
            setPermissions([...permissions, {
                target: `pipeline:${pipeline.id}`, // New permissions use ID
                canView: false,
                canRun: false,
                canEditYaml: false,
                canEditEnv: false,
                canViewResources: false,
                canUseClaude: false,
                canUseTerminal: false,
                ...updates
            }]);
        }
    };

    const togglePermission = (pipeline: Pipeline, field: keyof Omit<GranularPermission, 'target'>) => {
        const current = getPermissionForPipeline(pipeline);
        const newValue = !current[field];
        const updates: Partial<GranularPermission> = { [field]: newValue };

        if (field !== 'canView' && newValue) {
            updates.canView = true;
        }

        updatePermission(pipeline, updates);
    };

    if (loading) {
        return ReactDOM.createPortal(
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
                <div className="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-4xl border border-slate-700">
                    <div className="text-center text-slate-400">Loading permissions...</div>
                </div>
            </div>,
            document.body
        );
    }

    return ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
            <div className="bg-[var(--color-surface)] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-700 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-700 shrink-0">
                    <div className="flex items-center gap-3">
                        <Shield className="w-6 h-6 text-emerald-500" />
                        <div>
                            <h2 className="text-xl font-bold text-white">Manage User: {user.username}</h2>
                            <p className="text-sm text-slate-400">Configure details and permissions</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {/* User Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Email Address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="user@example.com"
                                className="w-full bg-black/40 border border-slate-600 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-emerald-500 outline-none"
                            />
                        </div>

                        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 flex flex-col justify-center">
                            <button
                                onClick={handleResetPermissions}
                                className="text-red-400 hover:text-red-300 text-sm font-medium hover:underline text-left"
                            >
                                Reset All Permissions
                            </button>
                            <p className="text-xs text-slate-500 mt-1">Clears all custom pipeline permissions.</p>
                        </div>
                    </div>

                    {/* Admin Toggle */}
                    <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isAdmin}
                                onChange={(e) => setIsAdmin(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 text-emerald-600 focus:ring-emerald-500"
                            />
                            <div>
                                <div className="font-semibold text-white flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-emerald-500" />
                                    Administrator
                                </div>
                                <div className="text-sm text-slate-400">Full access to all pipelines and settings</div>
                            </div>
                        </label>
                    </div>

                    {/* Can Manage Users Permission */}
                    {!isAdmin && (
                        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={canManageUsers}
                                    onChange={(e) => setCanManageUsers(e.target.checked)}
                                    className="w-5 h-5 rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                                />
                                <div>
                                    <div className="font-semibold text-white flex items-center gap-2">
                                        <Shield className="w-4 h-4 text-blue-500" />
                                        Can Manage Users
                                    </div>
                                    <div className="text-sm text-slate-400">Ability to create users and reset their passwords</div>
                                </div>
                            </label>
                        </div>
                    )}

                    {/* Per-Pipeline Permissions */}
                    {!isAdmin && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white">Per-Pipeline Permissions</h3>

                            {pipelines.length === 0 ? (
                                <div className="text-center py-8 text-slate-500">No pipelines available</div>
                            ) : (
                                <div className="space-y-3">
                                    {pipelines.map((pipeline) => {
                                        const perm = getPermissionForPipeline(pipeline);
                                        return (
                                            <div
                                                key={pipeline.id}
                                                className="bg-slate-900/30 border border-slate-700 rounded-lg p-4"
                                            >
                                                <div className="font-medium text-white mb-3">{pipeline.appName}</div>
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                    {/* View */}
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            checked={perm.canView}
                                                            onChange={() => togglePermission(pipeline, 'canView')}
                                                            className="w-4 h-4 rounded border-slate-600 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <div className="flex items-center gap-1 text-sm text-slate-400 group-hover:text-white transition-colors">
                                                            <Eye className="w-4 h-4" />
                                                            View
                                                        </div>
                                                    </label>

                                                    {/* Run */}
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            checked={perm.canRun}
                                                            onChange={() => togglePermission(pipeline, 'canRun')}
                                                            className="w-4 h-4 rounded border-slate-600 text-emerald-600 focus:ring-emerald-500"
                                                        />
                                                        <div className="flex items-center gap-1 text-sm text-slate-400 group-hover:text-white transition-colors">
                                                            <Play className="w-4 h-4" />
                                                            Run
                                                        </div>
                                                    </label>

                                                    {/* Edit YAML */}
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            checked={perm.canEditYaml}
                                                            onChange={() => togglePermission(pipeline, 'canEditYaml')}
                                                            className="w-4 h-4 rounded border-slate-600 text-purple-600 focus:ring-purple-500"
                                                        />
                                                        <div className="flex items-center gap-1 text-sm text-slate-400 group-hover:text-white transition-colors">
                                                            <FileCode className="w-4 h-4" />
                                                            YAML
                                                        </div>
                                                    </label>

                                                    {/* Edit ENV */}
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            checked={perm.canEditEnv}
                                                            onChange={() => togglePermission(pipeline, 'canEditEnv')}
                                                            className="w-4 h-4 rounded border-slate-600 text-orange-600 focus:ring-orange-500"
                                                        />
                                                        <div className="flex items-center gap-1 text-sm text-slate-400 group-hover:text-white transition-colors">
                                                            <Settings className="w-4 h-4" />
                                                            ENV
                                                        </div>
                                                    </label>

                                                    {/* View Resources (NEW) */}
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            checked={perm.canViewResources}
                                                            onChange={() => togglePermission(pipeline, 'canViewResources')}
                                                            className="w-4 h-4 rounded border-slate-600 text-cyan-600 focus:ring-cyan-500"
                                                        />
                                                        <div className="flex items-center gap-1 text-sm text-slate-400 group-hover:text-white transition-colors">
                                                            <Folder className="w-4 h-4" />
                                                            Resources
                                                        </div>
                                                    </label>

                                                    {/* Use Claude */}
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            checked={perm.canUseClaude}
                                                            onChange={() => togglePermission(pipeline, 'canUseClaude')}
                                                            className="w-4 h-4 rounded border-slate-600 text-purple-600 focus:ring-purple-500"
                                                        />
                                                        <div className="flex items-center gap-1 text-sm text-slate-400 group-hover:text-white transition-colors">
                                                            <Zap className="w-4 h-4" />
                                                            Claude
                                                        </div>
                                                    </label>

                                                    {/* Use Terminal */}
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            checked={perm.canUseTerminal}
                                                            onChange={() => togglePermission(pipeline, 'canUseTerminal')}
                                                            className="w-4 h-4 rounded border-slate-600 text-red-600 focus:ring-red-500"
                                                        />
                                                        <div className="flex items-center gap-1 text-sm text-slate-400 group-hover:text-white transition-colors">
                                                            <Terminal className="w-4 h-4" />
                                                            Terminal
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {isAdmin && (
                        <div className="text-center py-8 text-slate-400">
                            <Shield className="w-12 h-12 mx-auto mb-3 text-emerald-500 opacity-50" />
                            <p>Administrators have full access to all pipelines.</p>
                            <p className="text-sm mt-1">Per-pipeline permissions are not needed.</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default UserPermissionsModal;
