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
        <div className="space-y-6">
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

            {/* Email, admin only. Provider-driven; see MailSettings. */}
            <MailSettings />
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

interface MailField {
    key: string;
    label: string;
    type: 'text' | 'number' | 'boolean' | 'secret';
    placeholder?: string;
    required: boolean;
    hint?: string;
    value?: string;
    isSet?: boolean;
}

interface MailProviderMeta {
    id: string;
    label: string;
    blurb: string;
    fields: MailField[];
}

/**
 * Email configuration, for whichever provider is chosen.
 *
 * THE FORM IS GENERATED from what the server says each provider needs, rather
 * than hand-written per provider. The hand-written SMTP form is exactly how
 * this drifted from the route behind it: the form sent a password, the route
 * stored it, and the GET route handed it back unmasked, with nothing tying the
 * three together.
 *
 * A secret is never sent to this component - only whether one is stored - so
 * its input starts empty and an empty input means "leave it alone". That is
 * the normal state of an unedited form, and treating blank as "clear it" would
 * wipe the credential every time somebody fixed a typo in the sender address.
 */
const MailSettings: React.FC = () => {
    const { token, isAdmin } = useAuth();
    const [providers, setProviders] = useState<MailProviderMeta[]>([]);
    const [selected, setSelected] = useState<string>('');
    const [fields, setFields] = useState<MailField[]>([]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [configured, setConfigured] = useState(false);
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [emailToTest, setEmailToTest] = useState('');

    const authHeaders = { Authorization: `Bearer ${token}` };

    React.useEffect(() => {
        if (!isAdmin) return;
        fetch(`${API_URL}/api/settings/mail/providers`, { headers: authHeaders })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
            .then(d => {
                setProviders(d.providers ?? []);
                setSelected(d.selected ?? '');
                setConfigured(!!d.configured);
            })
            .catch(() => setMessage({ type: 'error', text: 'Could not load the mail providers.' }));
    }, [isAdmin, token]);

    // Load the chosen provider's stored values whenever the choice changes.
    React.useEffect(() => {
        if (!isAdmin || !selected) return;
        fetch(`${API_URL}/api/settings/mail?provider=${encodeURIComponent(selected)}`, { headers: authHeaders })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
            .then(d => {
                setFields(d.fields ?? []);
                const next: Record<string, string> = {};
                for (const f of (d.fields ?? []) as MailField[]) {
                    // Secrets stay blank: the server does not send them.
                    next[f.key] = f.type === 'secret' ? '' : (f.value ?? '');
                }
                setValues(next);
            })
            .catch(() => setMessage({ type: 'error', text: 'Could not load these settings.' }));
    }, [selected, isAdmin, token]);

    const save = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/api/settings/mail`, {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: selected, values }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setMessage({ type: 'success', text: 'Saved.' });
            // Re-read, so "stored" indicators reflect what actually landed.
            const fresh = await fetch(`${API_URL}/api/settings/mail?provider=${encodeURIComponent(selected)}`, { headers: authHeaders });
            if (fresh.ok) {
                const d = await fresh.json();
                setFields(d.fields ?? []);
                setValues(v => {
                    const next = { ...v };
                    for (const f of (d.fields ?? []) as MailField[]) if (f.type === 'secret') next[f.key] = '';
                    return next;
                });
            }
            setConfigured(true);
        } catch (e) {
            setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Could not save.' });
        } finally {
            setLoading(false);
        }
    };

    const sendTest = async () => {
        setTesting(true);
        setTestMessage(null);
        try {
            const res = await fetch(`${API_URL}/api/settings/mail/test`, {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: emailToTest }),
            });
            const data = await res.json().catch(() => ({}));
            // The provider's own reason, shown in full. "Check server logs" is
            // the least useful sentence available when the real problem is a
            // sender address the provider has not verified.
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setTestMessage({ type: 'success', text: data.message || 'Test message sent.' });
        } catch (e) {
            setTestMessage({ type: 'error', text: e instanceof Error ? e.message : 'Could not send.' });
        } finally {
            setTesting(false);
        }
    };

    if (!isAdmin) return null;

    const current = providers.find(p => p.id === selected);
    const inputCls = "w-full bg-black/40 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-600 focus:border-purple-500 outline-none";

    return (
        <div className="bg-slate-900/50 p-4 sm:p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm mt-8">
            <h2 className="text-lg sm:text-xl font-semibold mb-1 text-white flex items-center gap-2">
                <Mail className="w-5 h-5 text-purple-500 shrink-0" />
                Email
            </h2>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
                Used for verification codes and notifications. An API provider is
                preferable to SMTP: the key it issues can only send mail, where an
                SMTP password is access to a whole mailbox.
                {!configured && <span className="text-yellow-500"> Nothing is configured yet, so no mail is being sent.</span>}
            </p>

            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Provider</label>
            <select
                value={selected}
                onChange={e => { setSelected(e.target.value); setMessage(null); setTestMessage(null); }}
                className={inputCls + " mb-2"}
            >
                {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {current && <p className="text-xs text-slate-400 mb-5 leading-relaxed">{current.blurb}</p>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                {fields.map(f => (
                    <div key={f.key} className={f.type === 'boolean' ? 'md:col-span-2' : ''}>
                        <label htmlFor={`mail-${f.key}`} className="block text-xs text-slate-500 mb-1.5 font-medium">
                            {f.label}
                            {f.required && <span className="text-slate-600"> (required)</span>}
                            {f.type === 'secret' && f.isSet && (
                                <span className="ml-2 text-emerald-500">stored</span>
                            )}
                        </label>

                        {f.type === 'boolean' ? (
                            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                <input
                                    id={`mail-${f.key}`}
                                    type="checkbox"
                                    checked={values[f.key] === 'true'}
                                    onChange={e => setValues(v => ({ ...v, [f.key]: String(e.target.checked) }))}
                                />
                                {f.hint ?? f.label}
                            </label>
                        ) : (
                            <input
                                id={`mail-${f.key}`}
                                type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                                autoComplete={f.type === 'secret' ? 'new-password' : 'off'}
                                placeholder={f.type === 'secret' && f.isSet ? 'leave blank to keep the stored value' : (f.placeholder ?? '')}
                                value={values[f.key] ?? ''}
                                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                                className={inputCls}
                            />
                        )}
                        {f.hint && f.type !== 'boolean' && (
                            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{f.hint}</p>
                        )}
                    </div>
                ))}
            </div>

            <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                    onClick={save}
                    disabled={loading || !selected}
                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium w-full sm:w-auto"
                >
                    {loading ? 'Saving...' : 'Save'}
                </button>
                {message && (
                    <span role="status" className={`text-sm ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {message.text}
                    </span>
                )}
            </div>

            <div className="mt-6 pt-6 border-t border-slate-700">
                <label htmlFor="mail-test-to" className="block text-xs text-slate-500 mb-1.5 font-medium">
                    Send a test message
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        id="mail-test-to"
                        type="email"
                        placeholder="you@example.com"
                        value={emailToTest}
                        onChange={e => setEmailToTest(e.target.value)}
                        className={inputCls}
                    />
                    <button
                        onClick={sendTest}
                        disabled={testing || !emailToTest.includes('@')}
                        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap w-full sm:w-auto"
                    >
                        {testing ? 'Sending...' : 'Send test'}
                    </button>
                </div>
                {testMessage && (
                    <p role="status" className={`text-sm mt-3 leading-relaxed ${testMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {testMessage.text}
                    </p>
                )}
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    Saves are not needed first if nothing changed - the test uses what is stored.
                </p>
            </div>
        </div>
    );
};

// The one line whose absence took down the whole application.
//
// SettingsPage imports this eagerly, so a missing default export is not a
// broken TAB - it is a module-resolution failure in the graph the entry point
// walks, and the browser renders nothing at all. Every sibling tab in this
// directory has this line; this file never did.
export default GeneralTab;
