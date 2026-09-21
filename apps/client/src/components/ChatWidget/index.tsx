// DEAD CODE - superseded by components/AIAssistant. Nothing imports this file.
//
// DO NOT MOUNT IT AS-IS. It asks the operator to paste an Anthropic API key and
// keeps it in localStorage, where any script on the page can read it and where
// it survives sign-out. The assistant that replaced it keeps the key in the
// server environment, so the browser never holds one, and it enforces the
// useClaude permission - neither of which this file does.
//
// Kept only because this tree has no commit history to recover it from. Delete
// it once the repository has a real first commit.

import React, { useState, useEffect, useRef } from 'react';
import { Send, X, Bot, Minimize2, Settings, MessageSquare } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import API_URL from '../../config/api';
// import { useTheme } from '../../contexts/ThemeContext'; // Unused

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

const ChatWidget: React.FC = () => {
    const { token } = useAuth();
    // const { theme } = useTheme(); // Unused
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: "Hello! I'm your EZPipeline Assistant. How can I help you manage your pipelines today?" }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [apiKey, setApiKey] = useState(localStorage.getItem('anthropic_key') || '');
    const [showSettings, setShowSettings] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async () => {
        if (!input.trim() || loading) return;

        const userMsg = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);

        try {
            const res = await fetch(`${API_URL}/api/ai/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: userMsg,
                    history: messages.map(m => ({ role: m.role, content: m.content })),
                    apiKey: apiKey // In a real app, maybe don't send this every time if server has env, but for this feature requirement allowing user key:
                })
            });

            const data = await res.json();
            if (data.error) {
                setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error} ` }]);
            } else {
                setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
            }
        } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: "Failed to communicate with AI service." }]);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveKey = (key: string) => {
        setApiKey(key);
        localStorage.setItem('anthropic_key', key);
        setShowSettings(false);
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 lg:bottom-10 lg:right-10 w-14 h-14 bg-purple-600 hover:bg-purple-500 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 z-50 text-white"
            >
                <MessageSquare className="w-8 h-8" />
            </button>
        );
    }

    return (
        <div className={`fixed z - 50 transition - all duration - 300 ease -in -out bg - [#1e1e1e] border border - slate - 700 shadow - 2xl overflow - hidden flex flex - col
            ${isMinimized ? 'bottom-6 right-6 w-72 h-14 rounded-full' : 'bottom-4 right-3 left-3 sm:left-auto sm:right-6 w-auto sm:w-[400px] h-[min(600px,calc(100dvh-6rem))] rounded-xl'}
`}>
            {/* Header */}
            <div className={`flex items - center justify - between p - 3 bg - slate - 900 border - b border - slate - 700 ${isMinimized ? 'h-full border-none cursor-pointer' : ''} `}
                onClick={isMinimized ? () => setIsMinimized(false) : undefined}
            >
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-purple-600/20 rounded-full flex items-center justify-center">
                        <Bot className="w-5 h-5 text-purple-400" />
                    </div>
                    <span className="font-bold text-white">AI Assistant</span>
                </div>
                <div className="flex items-center gap-1">
                    {!isMinimized && (
                        <>
                            <button onClick={() => setShowSettings(!showSettings)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white" title="API Key Settings">
                                <Settings className="w-4 h-4" />
                            </button>
                            <button onClick={() => setIsMinimized(true)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white">
                                <Minimize2 className="w-4 h-4" />
                            </button>
                        </>
                    )}
                    {isMinimized && (
                        <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white ml-2">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                    {!isMinimized && (
                        <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Settings Overlay */}
            {!isMinimized && showSettings && (
                <div className="absolute inset-0 top-14 bg-slate-900/95 z-10 p-6 flex flex-col">
                    <h3 className="text-white font-bold mb-4">Settings</h3>
                    <label className="text-sm text-slate-400 mb-2">Anthropic API Key</label>
                    <input
                        type="password"
                        className="bg-slate-950 border border-slate-700 rounded p-2 text-white mb-4 text-sm"
                        placeholder="sk-ant-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowSettings(false)} className="px-3 py-1 text-slate-400 hover:text-white">Cancel</button>
                        <button onClick={() => handleSaveKey(apiKey)} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500">Save</button>
                    </div>
                </div>
            )}

            {/* Messages */}
            {!isMinimized && (
                <>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--color-bg)]">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb - 2`}>
                                <div className={`max - w - [85 %] rounded - 2xl px - 4 py - 2.5 text - sm shadow - sm ${msg.role === 'user'
                                    ? 'bg-purple-600 text-white rounded-tr-sm'
                                    : 'bg-slate-800 text-slate-100 rounded-tl-sm'
                                    } `}>
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 rounded-bl-none flex gap-1 items-center">
                                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-3 bg-slate-900 border-t border-slate-700">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                placeholder={apiKey ? "Ask AI Assistant..." : "Enter API Key in Settings to chat..."}
                                disabled={loading}
                                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                            />
                            <button
                                onClick={handleSend}
                                disabled={loading || !input.trim()}
                                className="p-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ChatWidget;
