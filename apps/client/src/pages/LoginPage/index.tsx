import React, { useState, useEffect } from 'react';

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import API_URL from '../../config/api';

const LoginPage: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState('');
    const [showRecovery, setShowRecovery] = useState(false);
    const toast = useToast();

    // MFA State
    const [mfaRequired, setMfaRequired] = useState(false);
    const [mfaCode, setMfaCode] = useState('');
    const [maskedEmail, setMaskedEmail] = useState('');
    const [isResending, setIsResending] = useState(false);

    // Setup State
    const [setupToken, setSetupToken] = useState('');
    const [emailSetupStep, setEmailSetupStep] = useState<'NONE' | 'EMAIL' | 'CODE'>('NONE');
    const [setupEmail, setSetupEmail] = useState('');

    const { login } = useAuth();
    const navigate = useNavigate();

    // Check if setup is required (e.g. after a reset)
    useEffect(() => {
        fetch(`${API_URL}/api/setup-status`)
            .then(res => res.json())
            .then(data => {
                if (!data.initialized) {
                    navigate('/setup');
                }
            })
            .catch(console.error);
    }, [navigate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const deviceToken = localStorage.getItem('device_token');
            const res = await fetch(`${API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, deviceToken })
            });

            const data = await res.json();

            if (res.ok) {
                if (data.mfaRequired) {
                    setMfaRequired(true);
                    setMaskedEmail(data.emailMasked);
                } else if (data.emailSetupRequired) {
                    setSetupToken(data.token);
                    setEmailSetupStep('EMAIL');
                    toast.error("System policy requires an email address. Please configure it now.");
                } else if (data.mfaSetupRequired) {
                    // This case should be rare now as email setup includes MFA auto-enable
                    login(data.token, data.username, data.isAdmin);
                    toast.error("MFA is enforced. Please set it up in your account settings.");
                    navigate('/settings?tab=account');
                } else {
                    login(data.token, data.username, data.isAdmin);
                    navigate('/');
                }
            } else {
                setError(data.error || 'Invalid credentials');
            }
        } catch (e) {
            setError('Login failed');
        }
    };

    const handleEmailChallenge = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const res = await fetch(`${API_URL}/api/auth/setup/email-challenge`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${setupToken}`
                },
                body: JSON.stringify({ email: setupEmail })
            });
            const data = await res.json();
            if (res.ok) {
                setEmailSetupStep('CODE');
            } else {
                setError(data.error || 'Failed to send verification code');
            }
        } catch (e) {
            setError('Failed to send code');
        }
    };

    const handleEmailVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const res = await fetch(`${API_URL}/api/auth/setup/email-verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${setupToken}`
                },
                body: JSON.stringify({ code: mfaCode })
            });
            const data = await res.json();
            if (res.ok) {
                login(data.token, data.username, data.isAdmin);
                toast.success("Email verified and MFA enabled. Welcome!");
                navigate('/');
            } else {
                setError(data.error || 'Verification failed');
            }
        } catch (e) {
            setError('Verification failed');
        }
    };

    // ... mfa handlers ...

    if (emailSetupStep === 'EMAIL') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
                <div className="bg-[var(--color-surface)] p-8 rounded-xl shadow-lg w-full max-w-md border border-[var(--color-surface)]">
                    <h1 className="text-2xl font-bold mb-6 text-center text-white">Setup Email</h1>
                    <p className="text-slate-400 text-center mb-6 text-sm">
                        System policy requires a verified email address for MFA.
                    </p>
                    {error && <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 text-sm">{error}</div>}
                    <form onSubmit={handleEmailChallenge} className="space-y-4">
                        <input
                            type="email"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)] placeholder-slate-600"
                            value={setupEmail}
                            onChange={(e) => setSetupEmail(e.target.value)}
                            placeholder="name@example.com"
                            autoFocus
                            required
                        />
                        <button type="submit" className="w-full bg-[var(--color-primary)] hover:opacity-90 text-white p-2 rounded font-medium transition-colors">
                            Send Verification Code
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    if (emailSetupStep === 'CODE') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
                <div className="bg-[var(--color-surface)] p-8 rounded-xl shadow-lg w-full max-w-md border border-[var(--color-surface)]">
                    <h1 className="text-2xl font-bold mb-6 text-center text-white">Verify Email</h1>
                    <p className="text-slate-400 text-center mb-6 text-sm">
                        Enter the code sent to <span className="text-white">{setupEmail}</span>
                    </p>
                    {error && <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 text-sm">{error}</div>}
                    <form onSubmit={handleEmailVerify} className="space-y-4">
                        <input
                            type="text"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)] placeholder-slate-600 text-center text-xl tracking-widest"
                            value={mfaCode}
                            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            autoFocus
                        />
                        <button type="submit" className="w-full bg-[var(--color-primary)] hover:opacity-90 text-white p-2 rounded font-medium transition-colors">
                            Verify & Login
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // ... existing returns ...

    const handleMFAVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const res = await fetch(`${API_URL}/api/auth/mfa/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, code: mfaCode, rememberMe })
            });

            const data = await res.json();

            if (res.ok) {
                if (data.deviceToken) {
                    localStorage.setItem('device_token', data.deviceToken);
                }
                login(data.token, data.username, data.isAdmin);
                navigate('/');
            } else {
                setError(data.error || 'Verification failed');
            }
        } catch (e) {
            setError('Verification failed');
        }
    };

    const handleResendCode = async () => {
        setIsResending(true);
        setError('');
        try {
            const res = await fetch(`${API_URL}/api/auth/mfa/resend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            if (!res.ok) {
                const data = await res.json();
                setError(data.error || 'Failed to resend code');
            }
        } catch (e) {
            setError('Failed to resend code');
        } finally {
            setIsResending(false);
        }
    };

    if (mfaRequired) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
                <div className="bg-[var(--color-surface)] p-8 rounded-xl shadow-lg w-full max-w-md border border-[var(--color-surface)]">
                    <h1 className="text-2xl font-bold mb-6 text-center">
                        <span className="text-emerald-500">Security</span>
                        <span className="text-white"> Verification</span>
                    </h1>
                    <p className="text-slate-400 text-center mb-6 text-sm">
                        Enter the 6-digit code sent to<br />
                        <span className="text-white font-medium">{maskedEmail || 'your email'}</span>
                    </p>

                    {error && <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 text-sm">{error}</div>}

                    <form onSubmit={handleMFAVerify} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Verification Code</label>
                            <input
                                type="text"
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)] placeholder-slate-600 text-center text-xl tracking-widest"
                                value={mfaCode}
                                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="000000"
                                autoFocus
                            />
                        </div>
                        <button
                            type="submit"
                            className="w-full bg-[var(--color-primary)] hover:opacity-90 text-white p-2 rounded font-medium transition-colors"
                        >
                            Verify
                        </button>
                    </form>

                    <div className="mt-6 flex justify-between items-center text-sm">
                        <button
                            onClick={() => setMfaRequired(false)}
                            className="text-slate-500 hover:text-white transition-colors"
                        >
                            Back to Login
                        </button>
                        <button
                            onClick={handleResendCode}
                            disabled={isResending}
                            className="text-[var(--color-primary)] hover:text-emerald-400 transition-colors disabled:opacity-50"
                        >
                            {isResending ? 'Sending...' : 'Resend Code'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
            <div className="bg-[var(--color-surface)] p-8 rounded-xl shadow-lg w-full max-w-md border border-[var(--color-surface)]">
                <h1 className="text-2xl font-bold mb-6 text-center">
                    <span className="text-emerald-500">EZ</span>
                    <span className="text-white">PIPELINE</span>
                </h1>
                {error && <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 text-sm">{error}</div>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
                        <input
                            type="text"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)] placeholder-slate-600"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter username"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-medium text-slate-400">Password</label>
                            {/* Was <a href="#">Forgot Password?</a>: a link that went
                                nowhere, offering a flow this app does not have. There
                                is no reset endpoint and no mail out, so the honest
                                answer is the one recovery path that exists. */}
                            <button
                                type="button"
                                onClick={() => setShowRecovery((v) => !v)}
                                className="text-xs text-[var(--color-primary)] hover:text-emerald-400 transition-colors -my-3.5 py-3.5 px-2 -mx-2"
                                aria-expanded={showRecovery}
                            >
                                Forgot Password?
                            </button>
                        </div>
                        <input
                            type="password"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-[var(--color-primary)] placeholder-slate-600"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                        />
                        {showRecovery && (
                            <p className="mt-2 text-xs leading-relaxed text-slate-400 bg-slate-900/70 border border-slate-700 rounded p-2">
                                There is no self-service password reset in EZPIPELINE.
                                Whoever runs the server can restore access from the
                                machine it runs on:
                                <code className="block mt-1 text-[var(--color-primary)]">npm run reset-password &lt;username&gt; &lt;new-password&gt;</code>
                                <span className="block mt-1">Use <code>npm run reset-password -- --list</code> to see account names.</span>
                            </p>
                        )}
                    </div>
                    <div className="flex min-h-11 items-center gap-2">
                        <input
                            type="checkbox"
                            id="remember"
                            className="size-4 rounded bg-slate-900 border-slate-700 text-[var(--color-primary)] focus:ring-0 focus:ring-offset-0"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                        />
                        <label htmlFor="remember" className="text-sm text-slate-400 cursor-pointer select-none">Remember Me</label>
                    </div>
                    <button
                        type="submit"
                        className="w-full bg-[var(--color-primary)] hover:opacity-90 text-white p-2 rounded font-medium transition-colors"
                    >
                        Sign In
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;
