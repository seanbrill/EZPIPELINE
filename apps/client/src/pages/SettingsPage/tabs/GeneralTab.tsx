import React, { useState } from 'react';
import { Computer, Trash2 } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { usePreferences } from '../../../contexts/PreferencesContext';
import { useAuth } from '../../../contexts/AuthContext';
import { TAG_COLORS } from '../../../constants/tagColors';

import API_URL from '../../../config/api';

const GeneralTab: React.FC = () => {
    const { theme, setTheme } = useTheme();
    const { enableAI, setEnableAI, organizationName, setOrganizationName } = usePreferences();
    // const { token } = useAuth(); // Unused now

    // ... (Keep existing return structure minus Security section)

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Appearance */}
            <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm">
                <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                    <Computer className="w-5 h-5 text-blue-500" />
                    Appearance & Behavior
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h3 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">Theme</h3>
                        <div className="flex gap-2">
                            {(['classic', 'midnight', 'light'] as const).map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setTheme(t)}
                                    className={`px-4 py-2 rounded-lg capitalize text-sm font-medium transition-all ${theme === t
                                        ? 'border-2 border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                                        : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-700'
                                        }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">AI Assistant</h3>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setEnableAI(!enableAI)}
                                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${enableAI ? 'bg-purple-600' : 'bg-slate-700'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enableAI ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                            <div>
                                <span className="block text-sm font-medium text-white">{enableAI ? 'Enabled' : 'Disabled'}</span>
                                <span className="text-xs text-slate-500">Reload required to apply</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-700/50">
                    <h3 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">Organization Settings</h3>
                    <div className="max-w-md">
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Default Organization Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Acme Corp"
                            value={organizationName}
                            onChange={(e) => setOrganizationName(e.target.value)}
                            className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
                        />
                        <p className="text-xs text-slate-500 mt-2">Used as the default author for new pipelines.</p>
                    </div>
                </div>

                {/* Environment Tags */}
                <div className="mt-8 pt-6 border-t border-slate-700/50">
                    <h3 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">Environment Tags</h3>
                    <EnvTagsSettings />
                </div>
            </div>

            {/* SMTP Settings (Admin Only) */}
            <SMTPSettings />
        </div>
    );
};

const EnvTagsSettings: React.FC = () => {
    const { envTagColors, setEnvTagColors, envTagLabels, setEnvTagLabels } = usePreferences();
    const [newTag, setNewTag] = useState('');
    const [newColor, setNewColor] = useState('emerald');
    const [newLabel, setNewLabel] = useState('');

    const handleAdd = () => {
        if (!newTag) return;
        const normalizedTag = newTag.toLowerCase().trim();
        setEnvTagColors({ ...envTagColors, [normalizedTag]: newColor });
        if (newLabel) {
            setEnvTagLabels({ ...envTagLabels, [normalizedTag]: newLabel.toUpperCase().trim() });
        }
        setNewTag('');
        setNewColor('emerald');
        setNewLabel('');
    };

    const handleDelete = (tag: string) => {
        const newTags = { ...envTagColors };
        delete newTags[tag];
        setEnvTagColors(newTags);

        const newLabels = { ...envTagLabels };
        delete newLabels[tag];
        setEnvTagLabels(newLabels);
    };

    const handleEdit = (tag: string) => {
        setNewTag(tag);
        setNewColor(envTagColors[tag] || 'emerald');
        setNewLabel(envTagLabels?.[tag] || '');
    };

    return (
        <div className="max-w-2xl space-y-6">
            <p className="text-xs text-slate-500">Map environment names (from pipeline.yaml) to badge colors and text. Click a tag to edit.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                {Object.entries(envTagColors).map(([tag, color]) => {
                    const style = TAG_COLORS[color] || TAG_COLORS['emerald'];
                    const label = envTagLabels?.[tag] || tag.substring(0, 4).toUpperCase();

                    return (
                        <div
                            key={tag}
                            onClick={() => handleEdit(tag)}
                            className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700 cursor-pointer hover:border-slate-500 transition-colors group"
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${style.dot}`} />
                                <div className="flex flex-col">
                                    <span className="text-sm font-mono text-slate-300 font-medium">{tag}</span>
                                    {envTagLabels?.[tag] && (
                                        <span className="text-[10px] text-slate-500">Label: {label}</span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(tag); }}
                                className="text-slate-500 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete Tag"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
                {Object.keys(envTagColors).length === 0 && (
                    <div className="col-span-2 text-center py-4 text-slate-500 italic text-sm border border-dashed border-slate-700 rounded-lg">
                        No custom tags configured. Add one below.
                    </div>
                )}
            </div>

            <div className="bg-slate-900/30 p-4 rounded-lg border border-slate-700/50">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                        {envTagColors[newTag.toLowerCase()] ? 'Edit Tag' : 'Add New Tag'}
                    </h4>
                    {newTag && (
                        <button
                            onClick={() => { setNewTag(''); setNewColor('emerald'); setNewLabel(''); }}
                            className="text-xs text-slate-500 hover:text-white"
                        >
                            Clear
                        </button>
                    )}
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Environment Name</label>
                            <input
                                type="text"
                                placeholder="e.g. uat"
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value)}
                                className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:border-emerald-500 outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Badge Label (Optional)</label>
                            <input
                                type="text"
                                placeholder="e.g. UAT"
                                value={newLabel}
                                onChange={(e) => setNewLabel(e.target.value)}
                                maxLength={5}
                                className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:border-emerald-500 outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-2 font-medium">Badge Color</label>
                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                            {Object.entries(TAG_COLORS).map(([key, def]) => (
                                <button
                                    key={key}
                                    onClick={() => setNewColor(key)}
                                    title={def.name}
                                    className={`
                                    w-8 h-8 rounded-full flex items-center justify-center transition-all
                                    ${def.dot}
                                    ${newColor === key ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'hover:scale-110 opacity-70 hover:opacity-100'}
                                `}
                                />
                            ))}
                        </div>
                        <p className="text-xs text-slate-500 mt-2">Selected: <span className="text-white font-medium capitalize">{newColor}</span></p>
                    </div>

                    <button
                        onClick={handleAdd}
                        disabled={!newTag}
                        className={`w-full py-2.5 rounded-lg text-sm font-bold shadow-lg transition-all ${newTag
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20 hover:shadow-emerald-900/40 transform hover:-translate-y-0.5'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                    >
                        {envTagColors[newTag.toLowerCase()] ? 'Update Tag' : 'Add Tag'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ... existing imports
import { Mail, Check, RefreshCw, Send } from 'lucide-react';

// ... existing GeneralTab component

const SMTPSettings: React.FC = () => {
    const { token, isAdmin } = useAuth();
    const [settings, setSettings] = useState({
        host: '',
        port: 587,
        secure: false,
        user: '',
        pass: '',
        from: ''
    });
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [emailToTest, setEmailToTest] = useState('');

    // Fetch settings on mount
    React.useEffect(() => {
        if (!isAdmin) return;
        fetch(`${API_URL}/api/settings/smtp`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data && !data.error) {
                    setSettings({
                        host: data.host || '',
                        port: data.port || 587,
                        secure: data.secure || false,
                        user: data.user || '',
                        pass: data.pass || '', // Often masked
                        from: data.from || ''
                    });
                }
            })
            .catch(console.error);
    }, [isAdmin, token]);

    const handleSave = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/api/settings/smtp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(settings)
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: "SMTP Settings saved successfully." });
            } else {
                setMessage({ type: 'error', text: data.error || "Failed to save settings." });
            }
        } catch (e) {
            setMessage({ type: 'error', text: "Network error saving settings." });
        } finally {
            setLoading(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setTestMessage(null);
        try {
            const res = await fetch(`${API_URL}/api/settings/smtp/test`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ to: emailToTest || settings.from || 'test@example.com' })
            });
            const data = await res.json();
            if (res.ok) {
                setTestMessage({ type: 'success', text: `Test email sent! ${data.info?.messageId || ''}` });
            } else {
                setTestMessage({ type: 'error', text: data.error || "Failed to send test email." });
            }
        } catch (e) {
            setTestMessage({ type: 'error', text: "Network error sending test." });
        } finally {
            setTesting(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm mt-8">
            <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                <Mail className="w-5 h-5 text-purple-500" />
                Email Configuration (SMTP)
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-xs text-slate-500 mb-1.5 font-medium">SMTP Host</label>
                    <input
                        type="text"
                        placeholder="smtp.gmail.com"
                        value={settings.host}
                        onChange={e => setSettings({ ...settings, host: e.target.value })}
                        className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-purple-500 outline-none"
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Port</label>
                        <input
                            type="number"
                            placeholder="587"
                            value={settings.port}
                            onChange={e => setSettings({ ...settings, port: parseInt(e.target.value) })}
                            className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-purple-500 outline-none"
                        />
                    </div>
                    <div className="flex items-center pt-6">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={settings.secure}
                                onChange={e => setSettings({ ...settings, secure: e.target.checked })}
                                className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="text-sm text-slate-300">Secure (SSL/TLS)</span>
                        </label>
                    </div>
                </div>

                <div>
                    <label className="block text-xs text-slate-500 mb-1.5 font-medium">Username</label>
                    <input
                        type="text"
                        placeholder="user@example.com"
                        value={settings.user}
                        onChange={e => setSettings({ ...settings, user: e.target.value })}
                        className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-purple-500 outline-none"
                    />
                </div>
                <div>
                    <label className="block text-xs text-slate-500 mb-1.5 font-medium">Password</label>
                    <div className="relative">
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={settings.pass}
                            onChange={e => setSettings({ ...settings, pass: e.target.value })}
                            className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-purple-500 outline-none"
                        />
                    </div>
                </div>

                <div className="md:col-span-2">
                    <label className="block text-xs text-slate-500 mb-1.5 font-medium">From Address</label>
                    <input
                        type="text"
                        placeholder="EZPipeline <noreply@ezpipeline.io>"
                        value={settings.from}
                        onChange={e => setSettings({ ...settings, from: e.target.value })}
                        className="w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-purple-500 outline-none"
                    />
                </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-700/50">
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-purple-900/20 transition-all disabled:opacity-50"
                    >
                        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save Settings
                    </button>
                    {message && (
                        <span className={`text-sm ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {message.text}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <input
                        type="email"
                        placeholder="Test email recipient"
                        value={emailToTest}
                        onChange={e => setEmailToTest(e.target.value)}
                        className="bg-black/40 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 outline-none w-48"
                    />
                    <button
                        onClick={handleTest}
                        disabled={testing || !settings.host}
                        className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50"
                    >
                        {testing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        Test
                    </button>
                </div>
            </div>
            {testMessage && (
                <div className={`mt-2 text-right text-sm ${testMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testMessage.text}
                </div>
            )}
        </div>
    );
};

export default GeneralTab;



