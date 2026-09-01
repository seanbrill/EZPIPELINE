import React, { useState, useEffect } from 'react';
import { Shield, Eye, EyeOff, Save } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import API_URL from '../../../config/api';

const MyAccountTab: React.FC = () => {
    const { token } = useAuth();
    const toast = useToast();
    const [loading, setLoading] = useState(true);

    // Profile State
    const [profile, setProfile] = useState<{ id: number, username: string, email: string | null, mfaEnabled: boolean }>({
        id: 0,
        username: '',
        email: '',
        mfaEnabled: false
    });
    const [email, setEmail] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);

    // Password State
    const [newPassword, setNewPassword] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    useEffect(() => {
        if (token) fetchProfile();
    }, [token]);

    const fetchProfile = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/users/me`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (data && !data.error) {
                setProfile({
                    id: data.id,
                    username: data.username,
                    email: data.email || '',
                    mfaEnabled: !!data.mfaEnabled
                });
                setEmail(data.email || '');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const updateProfile = async () => {
        setSavingProfile(true);
        try {
            const res = await fetch(`${API_URL}/api/users/${profile.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ email, username: profile.username })
            });

            if (res.ok) {
                toast.success("Profile updated successfully");
                fetchProfile();
            } else {
                const data = await res.json();
                toast.error(data.error || "Failed to update profile");
            }
        } catch (e) {
            toast.error("Error updating profile");
        } finally {
            setSavingProfile(false);
        }
    };

    // Check enforcement status
    const [isEnforced, setIsEnforced] = useState(false);

    useEffect(() => {
        fetchEnforcementStatus();
    }, [token]);

    const fetchEnforcementStatus = async () => {
        try {
            const res = await fetch(`${API_URL}/api/auth/config`);
            const data = await res.json();
            if (data && data.mfaEnforced !== undefined) {
                setIsEnforced(!!data.mfaEnforced);
            }
        } catch (e) {
            console.error("Failed to fetch MFA enforcement status", e);
        }
    };

    const toggleMFA = async () => {
        if (!profile.id) return;

        // If enforced, cannot disable
        if (isEnforced && profile.mfaEnabled) {
            toast.error("MFA is enforced by system policy and cannot be disabled.");
            return;
        }

        // Requirement: Must have email to enable MFA
        if (!profile.mfaEnabled && !profile.email && !email) {
            toast.error("Please set and save an email address before enabling MFA.");
            return;
        }

        const newState = !profile.mfaEnabled;

        // If not enforced and trying to enable... wait, "No User Level MFA".
        // If not enforced, user should NOT be able to enable it? 
        // "there should be no user level MFA only system wide MFA"
        // If so, I should block enabling it if !isEnforced explicitly.
        if (!isEnforced) {
            toast.error("MFA is currently disabled by system policy.");
            return;
        }

        // Optimistic update
        setProfile(prev => ({ ...prev, mfaEnabled: newState }));

        try {
            const res = await fetch(`${API_URL}/api/users/${profile.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ mfaEnabled: newState })
            });

            if (res.ok) {
                toast.success(`MFA ${newState ? 'Enabled' : 'Disabled'}`);
            } else {
                const data = await res.json();
                toast.error(data.error || "Failed to update MFA settings");
                setProfile(prev => ({ ...prev, mfaEnabled: !newState })); // Revert
            }
        } catch (e) {
            toast.error("Error updating MFA");
            setProfile(prev => ({ ...prev, mfaEnabled: !newState })); // Revert
        }
    };

    const changePassword = async () => {
        if (!currentPassword) return toast.error("Current password is required");
        if (!newPassword) return toast.error("New password is required");
        if (newPassword.length < 6) return toast.error("New password must be at least 6 characters");
        if (newPassword !== confirmPassword) return toast.error("Passwords do not match");

        try {
            const res = await fetch(`${API_URL}/api/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            if (res.ok) {
                toast.success("Password updated successfully");
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
            } else {
                const data = await res.json();
                toast.error(data.error || "Failed to update password");
            }
        } catch (e) {
            toast.error("Error updating password");
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500 animate-pulse">Loading account details...</div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Profile Section */}
            <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm">
                <h2 className="text-xl font-semibold mb-6 text-white flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold ring-2 ring-slate-800">
                        {profile.username.substring(0, 2).toUpperCase()}
                    </div>
                    My Profile
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Username</label>
                        <input
                            type="text"
                            value={profile.username}
                            onChange={(e) => setProfile({ ...profile, username: e.target.value })}
                            className="w-full bg-black/40 border border-slate-700 rounded-lg p-3 text-white placeholder-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Check to ensure username is unique.</p>
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Email Address</label>
                        <div className="flex gap-2">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                className="w-full bg-black/40 border border-slate-700 rounded-lg p-3 text-white placeholder-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                            />
                            <button
                                onClick={updateProfile}
                                disabled={savingProfile || email === profile.email}
                                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 rounded-lg transition-colors flex items-center justify-center shrink-0"
                            >
                                {savingProfile ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">Used for notifications and MFA recovery.</p>
                    </div>
                </div>
            </div>

            {isEnforced && (
                <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm">
                    <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                        <Shield className="w-5 h-5 text-emerald-500" />
                        System Security Policy
                    </h2>

                    <div className="mt-4 bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${profile.mfaEnabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                <Shield className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-white">Multi-Factor Authentication</h3>
                                <p className="text-xs text-slate-400">
                                    {profile.mfaEnabled
                                        ? "Active and Enforced."
                                        : "Required by System Policy."}
                                </p>
                            </div>
                        </div>

                        {!profile.mfaEnabled && (
                            <button
                                onClick={toggleMFA}
                                className="relative inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
                            >
                                Setup MFA
                            </button>
                        )}

                        {profile.mfaEnabled && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                                Active
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Change Password */}
            <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm">
                <h2 className="text-xl font-semibold mb-6 text-white">Change Password</h2>

                <div className="max-w-md space-y-4">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Current Password</label>
                        <div className="relative">
                            <input
                                type={showCurrentPassword ? "text" : "password"}
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                className="w-full bg-black/40 border border-slate-700 rounded-lg px-4 py-2.5 text-white pr-10 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                            >
                                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">New Password</label>
                            <div className="relative">
                                <input
                                    type={showNewPassword ? "text" : "password"}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full bg-black/40 border border-slate-700 rounded-lg px-4 py-2.5 text-white pr-10 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                                >
                                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Confirm Password</label>
                            <div className="relative">
                                <input
                                    type={showConfirmPassword ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full bg-black/40 border border-slate-700 rounded-lg px-4 py-2.5 text-white pr-10 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                                >
                                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={changePassword}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-lg font-bold shadow-lg shadow-emerald-900/20 transition-all hover:scale-[1.02] active:scale-[0.98] w-full md:w-auto"
                        >
                            Update Password
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MyAccountTab;
