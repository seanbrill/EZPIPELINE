import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import API_URL from '../../config/api';

const SetupPage: React.FC = () => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/setup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            if (res.ok) {
                const data = await res.json();
                login(data.token, data.username, data.isAdmin); // or true
                navigate('/');
            } else {
                const data = await res.json();
                setError(data.error || 'Setup failed');
            }
        } catch (e) {
            setError('Setup failed');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
            <div className="bg-[var(--color-surface)] p-8 rounded-xl shadow-lg w-full max-w-md border border-emerald-500/30">
                <h1 className="text-3xl font-bold mb-2 text-center text-[var(--color-primary)]">Welcome to EZPIPELINE</h1>
                <p className="text-center text-slate-400 mb-6">Create your admin account to get started.</p>

                {error && <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 text-sm border border-red-500/20">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Admin Username</label>
                        <input
                            type="text"
                            className="w-full bg-black/20 border border-slate-700/50 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)]"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Email <span className="text-slate-600 text-xs">(Required for MFA)</span></label>
                        <input
                            type="email"
                            className="w-full bg-black/20 border border-slate-700/50 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)]"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
                        <input
                            type="password"
                            className="w-full bg-black/20 border border-slate-700/50 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)]"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Confirm Password</label>
                        <input
                            type="password"
                            className="w-full bg-black/20 border border-slate-700/50 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)]"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full bg-[var(--color-primary)] hover:opacity-90 text-white p-2 rounded font-medium transition-colors mt-2"
                    >
                        Create Admin Account
                    </button>
                </form>
            </div>
        </div>
    );
};

export default SetupPage;
