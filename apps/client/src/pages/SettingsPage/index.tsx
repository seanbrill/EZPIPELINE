import React, { useState } from 'react';
import { Settings, Key, FileText, Users, Network, Database, Menu, UserCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

import MyAccountTab from './tabs/MyAccountTab';
import GeneralTab from './tabs/GeneralTab';
import EnvironmentTab from './tabs/EnvironmentTab';
import ResourcesTab from './tabs/ResourcesTab';
import UsersTab from './tabs/UsersTab';
import PluginsTab from './tabs/PluginsTab';
import SystemTab from './tabs/SystemTab';

import { useSearchParams } from 'react-router-dom';

const SettingsPage: React.FC = () => {
    const { isAdmin } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = (searchParams.get('tab') as 'account' | 'general' | 'env' | 'resources' | 'users' | 'plugins' | 'system') || 'account';
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const tabs = [
        { id: 'account', label: 'My Account', icon: UserCircle, adminOnly: false },
        { id: 'general', label: 'General', icon: Settings, adminOnly: false },
        { id: 'env', label: 'Environment', icon: Key, adminOnly: false },
        { id: 'resources', label: 'Resources', icon: FileText, adminOnly: false },
        { id: 'plugins', label: 'Plugins', icon: Network, adminOnly: false },
        { id: 'users', label: 'Users', icon: Users, adminOnly: true },
        { id: 'system', label: 'System', icon: Database, adminOnly: true },
    ];

    const CurrentTab = () => {
        switch (activeTab) {
            case 'account': return <MyAccountTab />;
            case 'general': return <GeneralTab />;
            case 'env': return <EnvironmentTab />;
            case 'resources': return <ResourcesTab />;
            case 'plugins': return <PluginsTab />;
            case 'users': return <UsersTab />;
            case 'system': return <SystemTab />;
            default: return <MyAccountTab />;
        }
    };

    const handleTabClick = (id: string) => {
        setSearchParams({ tab: id });
        setMobileMenuOpen(false);
    };

    return (
        <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row gap-8">
                    {/* Sidebar Navigation */}
                    <aside className="w-full md:w-64 shrink-0 space-y-4">
                        <div className="flex items-center justify-between md:block">
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                                Settings
                            </h1>
                            <button
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                                className="md:hidden p-2 text-slate-400 hover:text-white"
                            >
                                <Menu className="w-6 h-6" />
                            </button>
                        </div>

                        <nav className={`flex flex-col gap-1 transition-all ${mobileMenuOpen ? 'block' : 'hidden md:flex'}`}>
                            {tabs.map((tab) => {
                                if (tab.adminOnly && !isAdmin) return null;
                                const isActive = activeTab === tab.id;
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => handleTabClick(tab.id)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${isActive
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg shadow-emerald-900/10'
                                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 hover:pl-5'
                                            }`}
                                    >
                                        <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-500' : 'text-slate-500'}`} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </nav>
                    </aside>

                    {/* Main Content Area */}
                    <main className="flex-1 min-w-0">
                        <div className="bg-[var(--color-surface)]/50 backdrop-blur-sm rounded-none md:rounded-2xl border-none md:border border-slate-700/50 p-0 md:p-1 min-h-[600px]">
                            <CurrentTab />
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;
