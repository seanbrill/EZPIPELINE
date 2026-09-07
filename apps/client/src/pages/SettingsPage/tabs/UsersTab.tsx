import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, Trash2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import UserPermissionsModal from '../../../components/UserPermissionsModal';
import AgentTokenModal from '../../../components/AgentTokenModal';
import { useConfirm } from '../../../contexts/ConfirmationContext';
import { useToast } from '../../../contexts/ToastContext';

import API_URL from '../../../config/api';

interface User {
    id: number;
    username: string;
    email?: string;
    created_at: string;
    isAdmin?: boolean;
}

const UsersTab: React.FC = () => {
    const { token, isAdmin } = useAuth();
    const { confirm } = useConfirm();
    const toast = useToast();

    const [users, setUsers] = useState<User[]>([]);
    const [newUser, setNewUser] = useState({ username: '', password: '' });
    const [selectedUserForPerms, setSelectedUserForPerms] = useState<User | null>(null);
    const [showAgentModal, setShowAgentModal] = useState(false);

    useEffect(() => {
        if (token) fetchUsers();
    }, [token]);

    const fetchUsers = async () => {
        try {
            const res = await fetch(`${API_URL}/api/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setUsers(data.users || []);
        } catch (e) {
            console.error("Failed to fetch users");
        }
    };

    const addUser = async () => {
        if (!newUser.username || !newUser.password) return;
        try {
            const res = await fetch(`${API_URL}/api/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(newUser)
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("User added successfully");
                setNewUser({ username: '', password: '' });
                fetchUsers();
            } else {
                toast.error(data.error || "Failed to add user");
            }
        } catch (e) {
            toast.error("Error adding user");
        }
    };

    const deleteUser = async (id: number) => {
        if (!await confirm({
            title: "Delete User?",
            message: "Are you sure you want to delete this user? This action cannot be undone.",
            confirmText: "Delete User",
            isDangerous: true
        })) return;

        try {
            const res = await fetch(`${API_URL}/api/users/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                fetchUsers();
                toast.success("User deleted successfully");
            } else {
                toast.error("Failed to delete user");
            }
        } catch (e) {
            toast.error("Error deleting user");
        }
    };

    if (!isAdmin) {
        return (
            <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 text-center text-slate-400">
                <Shield className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-500" />
                    User Management
                </h2>
            </div>

            <div className="mb-8 p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
                <h3 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Create New User</h3>
                <div className="flex flex-col md:flex-row gap-3">
                    <input
                        type="text"
                        placeholder="Username"
                        value={newUser.username}
                        onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                        className="flex-1 bg-black/40 border border-slate-600 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-emerald-500 outline-none transition-all"
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={newUser.password}
                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        className="flex-1 bg-black/40 border border-slate-600 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-emerald-500 outline-none transition-all"
                    />
                    <button
                        onClick={addUser}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-lg transition-all flex items-center gap-2 font-bold shadow-lg shadow-emerald-900/20 hover:scale-[1.02] active:scale-[0.98]"
                    >
                        <UserPlus className="w-4 h-4" />
                        Add User
                    </button>
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-700/50 shadow-inner">
                <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-[#1a1f2e] text-slate-400 uppercase font-bold text-xs tracking-wider">
                        <tr>
                            <th className="px-6 py-4">ID</th>
                            <th className="px-6 py-4">Username</th>
                            <th className="px-6 py-4">Email</th>
                            <th className="px-6 py-4">Created</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-900/30">
                        {users.map((user) => (
                            <tr key={user.id} className="hover:bg-slate-800/40 transition-colors group">
                                <td className="px-6 py-4 text-slate-500 font-mono text-xs">{user.id}</td>
                                <td className="px-6 py-4 font-bold text-white flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs text-white uppercase shadow-lg">
                                        {user.username.substring(0, 2)}
                                    </div>
                                    {user.username}
                                    {user.isAdmin && <span className="text-[10px] bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-500/20 ml-2">ADMIN</span>}
                                </td>
                                <td className="px-6 py-4 text-slate-400 text-xs">{user.email || '-'}</td>
                                <td className="px-6 py-4 text-slate-400">{new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                                <td className="px-6 py-4 flex gap-2 justify-end">
                                    <button
                                        onClick={() => setSelectedUserForPerms(user)}
                                        className="text-emerald-400 hover:text-white p-2 rounded-lg hover:bg-emerald-600 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        title="Manage Permissions"
                                    >
                                        <Shield className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => deleteUser(user.id)}
                                        className="text-red-400 hover:text-white p-2 rounded-lg hover:bg-red-600 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        title="Delete User"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {users.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-slate-500 italic">No users found</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedUserForPerms && (
                <UserPermissionsModal
                    user={selectedUserForPerms}
                    onClose={() => setSelectedUserForPerms(null)}
                    onUpdate={fetchUsers}
                />
            )}

            {showAgentModal && (
                <AgentTokenModal onClose={() => setShowAgentModal(false)} />
            )}
        </div>
    );
};

export default UsersTab;
