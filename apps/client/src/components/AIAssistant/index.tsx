import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Terminal, Send, X, Loader2, RotateCcw, Copy, Trash2, GripHorizontal, ExternalLink, Power } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Ansi from 'ansi-to-react';
import API_URL from '../../config/api';

// Draggable Helper Hook
const useDraggable = () => {
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef({ x: 0, y: 0 });
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            // Cancel any pending animation frame
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }

            // Use requestAnimationFrame for smooth updates
            rafRef.current = requestAnimationFrame(() => {
                setPosition({
                    x: e.clientX - offsetRef.current.x,
                    y: e.clientY - offsetRef.current.y
                });
                rafRef.current = null;
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [isDragging]);

    const startDrag = (e: React.MouseEvent) => {
        if (dragRef.current) {
            const rect = dragRef.current.getBoundingClientRect();
            offsetRef.current = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
            setIsDragging(true);
        }
    };

    return { position, startDrag, dragRef, isDragging };
};

type AIStatus = 'checking' | 'not-installed' | 'not-configured' | 'installing' | 'login-required' | 'logging-in' | 'authenticating' | 'ready' | 'active';

const AIAssistant: React.FC = () => {
    const { token } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [status, setStatus] = useState<AIStatus>('checking');
    // The server's own words for why the assistant cannot answer.
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [input, setInput] = useState('');
    const [logs, setLogs] = useState<string[]>([]);
    const [isInitializing, setIsInitializing] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [authUrl, setAuthUrl] = useState<string | null>(null);

    // Refs
    const isInitializingRef = useRef(false);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const isInstallingRef = useRef(false);
    const isRestartingRef = useRef(false);
    const hasShownWelcomeRef = useRef(false);
    const lastInputRef = useRef<string>("");

    // Draggable
    const { position, startDrag, dragRef, isDragging } = useDraggable();

    // Default position (bottom-right) override if dragged
    const style = position.x !== 0 ? {
        left: position.x,
        top: position.y,
        transform: 'none',
        right: 'auto',
        bottom: 'auto'
    } : {};

    // Sync ref with state
    useEffect(() => {
        isInitializingRef.current = isInitializing;
    }, [isInitializing]);

    // Textarea ref & Auto-resize
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = '46px';
            const scrollHeight = textareaRef.current.scrollHeight;
            if (scrollHeight > 46) {
                textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
            }
        }
    }, [input]);

    // Auto-scroll
    const scrollToBottom = () => {
        if (chatEndRef.current) {
            const parent = chatEndRef.current.parentElement;
            if (parent) {
                parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
            }
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [logs, isInitializing, isTyping, authUrl]);

    useEffect(() => {
        if (isInitializing) {
            const timeout = setTimeout(() => {
                console.warn('[AIAssistant] Initialization timeout, forcing complete');
                setIsInitializing(false);
                setLogs(prev => [...prev, "\\x1b[33m⚠️ Initialization took longer than expected. Agent should be ready.\\x1b[0m"]);
            }, 45000);
            return () => clearTimeout(timeout);
        }
    }, [isInitializing]);

    const checkStatus = async () => {
        if (!token) return;
        try {
            const res = await fetch(`${API_URL}/api/ai/status`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setStatusMessage(typeof data.message === 'string' ? data.message : null);

            // `configured` and `message` are what the server actually knows.
            // `installed`/`loggedIn` are compatibility shims it still sends:
            // installed is now hard-coded true, so reading those two mapped an
            // unconfigured server to 'ready' and drew "Agent is ready to help
            // you" over an assistant with no API key. The panel then offered
            // "(Re)Authenticate", which cannot supply a key that lives in the
            // server's environment. Every message failed and nothing on screen
            // said why.
            if (typeof data.configured === 'boolean') {
                setStatus(data.configured ? 'active' : 'not-configured');
            } else if (data.loggedIn) {
                setStatus('active');
            } else if (!data.installed) {
                setStatus('not-installed');
            } else {
                setStatus('ready');
            }
        } catch (err) {
            console.error("Failed to check status", err);
        }
    };

    const sendAction = async (action: string, payload: any = {}) => {
        if (!socket) return;

        if (action === 'install') {
            isInstallingRef.current = true;
            setStatus('installing');
            setLogs([]);
        }
        if (action === 'login') {
            setStatus('active');
            setLogs([]);
            setAuthUrl(null);
        }
        if (action === 'spawn') {
            if (status === 'active') {
                isRestartingRef.current = true;
            }
            setStatus('active');
            setAuthUrl(null);
            setIsInitializing(true);
        }

        try {
            await fetch(`${API_URL}/api/ai/action`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    action,
                    socketId: socket.id,
                    ...payload
                })
            });
        } catch (err) {
            console.error("Failed to send action:", err);
            setLogs(prev => [...prev, `\\x1b[31m❌ Network Request Failed\\x1b[0m`]);
            setIsTyping(false);
        }

        if (action === 'install') {
            await new Promise(resolve => setTimeout(resolve, 1500));
            isInstallingRef.current = false;
            checkStatus();
        }
    };

    const handleSendInput = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim()) return;
        if (!socket?.connected) {
            console.error('[AIAssistant] Socket not connected');
            setLogs(prev => [...prev, "\\x1b[31m❌ Connection lost. Reconnecting...\\x1b[0m"]);
            socket?.connect();
            return;
        }

        setLogs(prev => [...prev, `\\x1b[38;2;255;255;255mUSER_MSG_START${input}USER_MSG_END\\x1b[0m`]);
        lastInputRef.current = input.trim();
        setIsTyping(true);
        sendAction('input', { input: input });
        setInput('');
    };

    const handleClearChat = () => {
        setLogs([]);
    };

    const handleCopyChat = () => {
        const transcript = logs.map(l => {
            // 1. User Message
            const userMsgMatch = l.match(/USER_MSG_START(.*?)USER_MSG_END/);
            if (userMsgMatch) {
                return `User: ${userMsgMatch[1].trim()}`;
            }

            // 2. Strip ANSI
            const clean = l.replace(/\\x1b\[[0-9;]*m/g, '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

            // 3. System/Error
            if (clean.includes('Error:') || clean.includes('❌') || clean.includes('✅')) {
                return `[System]: ${clean.trim()}`;
            }

            // 4. Claude
            if (!clean.trim()) return null;
            return `Claude: ${clean.trim()}`;
        }).filter(Boolean).join('\n\n');

        navigator.clipboard.writeText(transcript);
    };

    const handleRestart = () => {
        setLogs([]);
        sendAction('spawn');
    };

    useEffect(() => {
        if (!token) return;
        const newSocket = io(API_URL, { auth: { token }, reconnection: true, reconnectionAttempts: 5 });

        newSocket.on('connect', () => { checkStatus(); });
        newSocket.on('claude-init-complete', () => {
            setIsInitializing(false);
            if (!hasShownWelcomeRef.current) {
                hasShownWelcomeRef.current = true;
                setLogs(prev => [...prev, `\u001b[32m✨ Agent Connected & Ready to Help!\u001b[0m`]);
            }
        });

        newSocket.on('claude-output', (data: string) => {
            setIsTyping(false);
            const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
            const cleanData = stripAnsi(data);

            if (cleanData.includes('Channelling...') || cleanData.includes('Hyperspacing...') || cleanData.includes('Swirling...') || cleanData.includes('Unravelling...') || cleanData.includes('Razzle-dazzling...') || cleanData.includes('Tinkering') || cleanData.includes('Baked for') || cleanData.includes('thought for') || cleanData.includes('Sketching') || cleanData.includes('Fluttering') || cleanData.includes('? for shortcuts') || cleanData.includes('esc to interrupt') || cleanData.includes('ctrl+g to edit') || cleanData.includes('AI Sandbox Setup') || cleanData.includes('Tip: Did you know') || cleanData.includes('Tip: Create custom slash commands')) return;

            const urlMatch = data.match(/(https:\/\/console\.anthropic\.com\/auth\/verify\?code=[a-zA-Z0-9_-]+)/);
            if (urlMatch) setAuthUrl(urlMatch[1]);

            const norm = data.replace(/\r\n/g, '\\n').replace(/\r/g, '\\n');
            const lines = norm.split('\\n');
            const activeLines = lines.filter(l => {
                if (l.match(/\x1b\]0;/)) return false;
                const trimmed = l.trim();
                const plainText = stripAnsi(trimmed);
                if (plainText.trim().length === 0) return false;
                if (plainText.match(/^[─\s0-9]+$/) && plainText.includes('─')) return false;
                if (lastInputRef.current && plainText.trim() === lastInputRef.current) return false;
                const noisy = ['? for shortcuts', 'esc to interrupt', 'ctrl+g to edit', 'Cost:', 'Context:', 'Tokens:'];
                if (noisy.some(n => plainText.includes(n))) return false;
                if (trimmed.startsWith('❯')) return false;
                return true;
            });

            if (activeLines.length > 0) setLogs(prev => [...prev, ...activeLines]);
        });

        newSocket.on('claude-success', (msg) => {
            setLogs(prev => [...prev, `\\x1b[32m✅ ${msg}\\x1b[0m`]);
            if (msg.includes("Authentication successful")) { setAuthUrl(null); setTimeout(() => setStatus('ready'), 1000); }
            setTimeout(() => checkStatus(), 500);
        });
        newSocket.on('claude-error', (msg) => { setIsTyping(false); setLogs(prev => [...prev, `\\x1b[31m❌ Error: ${msg}\\x1b[0m`]); });
        newSocket.on('claude-exit', () => { setIsTyping(false); if (isRestartingRef.current) { isRestartingRef.current = false; return; } if (!isInstallingRef.current) checkStatus(); });

        setSocket(newSocket);
        return () => { newSocket.disconnect(); };
    }, [token]);

    const renderLogLine = (log: string, index: number) => {
        // 1. User Message (Right Bubble)
        const userMsgMatch = log.match(/USER_MSG_START(.*?)USER_MSG_END/);
        if (userMsgMatch) {
            return (
                <div key={index} className="flex justify-end mb-4 animate-in fade-in slide-in-from-right-2 duration-300">
                    <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] shadow-md text-sm font-medium leading-relaxed">
                        {userMsgMatch[1]}
                    </div>
                </div>
            );
        }

        // 2. System/Terminal Logs (Full width, mono, colored)
        // Detect commonly used ANSI colors for system events
        const isSystemLog = log.includes('[31m') || // Red (Error)
            log.includes('[32m') || // Green (Success)
            log.includes('[33m') || // Yellow (Warning)
            log.includes('[34m') || // Blue
            log.includes('[35m') || // Magenta
            log.includes('[36m') || // Cyan
            log.includes('[90m');   // Gray (often debug)

        if (isSystemLog) {
            // Check specific colors for slight styling adjustments (optional)
            return (
                <div key={index} className="pl-2 mb-2 font-mono text-xs leading-5 break-all whitespace-pre-wrap opacity-90">
                    <Ansi>{log}</Ansi>
                </div>
            );
        }

        // 3. AI Conversational Message (Left Bubble)
        // Default text, likely the AI speaking naturally
        return (
            <div key={index} className="flex justify-start mb-4 animate-in fade-in slide-in-from-left-2 duration-300">
                <div className="bg-[#2a2a2a] text-zinc-100 px-4 py-3 rounded-2xl rounded-tl-sm max-w-[85%] shadow-sm border border-[#333]">
                    <div className="text-sm leading-relaxed whitespace-pre-wrap font-sans">
                        <Ansi>{log}</Ansi>
                    </div>
                </div>
            </div>
        );
    };

    const renderContent = () => {
        switch (status) {
            case 'checking':
                return <div className="h-full flex items-center justify-center text-slate-400 font-sans"><Loader2 className="animate-spin mr-2" /> Checking Status...</div>;

            case 'not-installed':
                return (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 p-6 bg-emerald-950/20">
                        <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/20 mb-2">
                            <Terminal className="w-8 h-8 text-emerald-500" />
                        </div>
                        <h3 className="font-bold text-white text-lg tracking-tight">AI Agent Setup</h3>
                        <p className="text-zinc-400 text-xs max-w-[240px] leading-relaxed">
                            Initialize the Claude secure agent to assist with pipelines and configuration.
                        </p>
                        <button
                            onClick={() => sendAction('install')}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-emerald-900/20 hover:shadow-emerald-900/40 w-full"
                        >
                            Initialize Agent
                        </button>
                    </div>
                );
            case 'not-configured':
                return (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 p-6 bg-[#111]">
                        <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-500/20 mb-2">
                            <Terminal className="w-8 h-8 text-amber-500" />
                        </div>
                        <h3 className="font-bold text-white text-lg tracking-tight">Assistant not configured</h3>
                        <p className="text-zinc-400 text-xs max-w-[260px] leading-relaxed">
                            {statusMessage ?? 'This server has no Anthropic API key set, so the assistant cannot answer. Set ANTHROPIC_API_KEY in the server environment and restart it.'}
                        </p>
                        <button
                            onClick={() => checkStatus()}
                            className="bg-[#333] hover:bg-[#444] text-white px-6 py-2 rounded-lg transition-all font-medium border border-[#444] text-sm"
                        >
                            Check again
                        </button>
                    </div>
                );
            case 'installing':
                return (
                    <div className="flex flex-col items-center justify-center h-full space-y-4 bg-[#111]">
                        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                        <span className="text-sm font-medium text-emerald-500/80 animate-pulse">Installing Sandbox Environment...</span>
                    </div>
                );
            case 'ready':
                return (
                    <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-4 font-sans bg-[#111]">
                        <div className="w-16 h-16 bg-emerald-600/20 rounded-full flex items-center justify-center mb-2 shadow-lg shadow-emerald-900/20">
                            <Terminal className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white">Claude Assistant</h3>
                        <p className="text-sm text-slate-400 max-w-xs leading-relaxed">Agent is ready to help you build pipelines and manage your project.</p>
                        <div className="flex gap-3">
                            <button onClick={() => sendAction('login')} className="flex items-center gap-2 bg-[#333] hover:bg-[#444] text-white px-6 py-2 rounded-lg transition-all font-medium border border-[#444]">
                                (Re)Authenticate
                            </button>
                            <button onClick={() => sendAction('spawn')} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg transition-all shadow-lg hover:shadow-emerald-500/25 font-medium">
                                <Power className="w-4 h-4" /> Start Agent
                            </button>
                        </div>
                    </div>
                );
            default:
                return (
                    <div className="flex flex-col h-full bg-[#111111]">
                        {/* Logs */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                            <div className="h-4"></div>
                            {logs.map((log, i) => renderLogLine(log, i))}

                            {/* Auth Link */}
                            {authUrl && (
                                <div className="my-4 p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-lg flex flex-col items-center gap-3">
                                    <span className="text-emerald-300 font-medium text-sm">Action Required: Authenticate with Anthropic</span>
                                    <a href={authUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-md text-sm font-semibold transition-colors">
                                        Visit Auth URL <ExternalLink className="w-3 h-3" />
                                    </a>
                                </div>
                            )}

                            {/* Typing Bubble */}
                            {(isInitializing || isTyping) && (
                                <div className="flex justify-start mb-2 animate-in fade-in zoom-in-95 duration-200">
                                    <div className="bg-[#2a2a2a] px-4 py-3 rounded-2xl rounded-tl-sm border border-[#333] flex items-center gap-2.5 shadow-md">
                                        <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                        <span className="text-xs font-medium text-zinc-400 tracking-wide">
                                            {isInitializing ? "Initializing Agent..." : "Claude is thinking..."}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        {/* Input */}
                        {/* Input */}
                        <div
                            className="p-4 bg-[#1a1a1a] border-t border-[#333] flex gap-3 items-end cursor-text"
                            onClick={() => textareaRef.current?.focus()}
                        >
                            <textarea
                                key={isInitializing ? 'init' : 'ready'}
                                ref={textareaRef}
                                rows={1}
                                autoFocus
                                disabled={isInitializing}
                                value={input}
                                onChange={(e) => {
                                    setInput(e.target.value);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendInput();
                                    }
                                }}
                                placeholder={isInitializing ? "Initializing..." : "Ask Claude... (Shift+Enter for new line)"}
                                className={`flex-1 bg-[#111] border border-[#333] hover:border-[#444] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-sans text-sm placeholder:text-zinc-600 resize-none overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent leading-[20px] ${isInitializing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                style={{ minHeight: '46px', maxHeight: '120px' }}
                            />
                            <button type="button" onClick={() => handleSendInput()} disabled={!input.trim()} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white p-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 shrink-0 h-[46px] w-[46px] flex items-center justify-center">
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                );
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-20 right-6 w-14 h-14 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-2xl shadow-emerald-900/40 flex items-center justify-center transition-all hover:scale-105 active:scale-95 z-50 group border border-white/10"
            >
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent to-white/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                {status === 'active' && <span className="absolute top-0 right-0 w-3 h-3 bg-white rounded-full border-2 border-emerald-600"></span>}
                <Terminal className="w-6 h-6" />
            </button>
        );
    }

    return (
        <div
            style={style}
            className="fixed bottom-20 right-3 left-3 sm:left-auto sm:right-6 w-auto sm:w-[450px] h-[min(600px,calc(100dvh-7rem))] bg-[#111] rounded-2xl shadow-2xl shadow-black/80 flex flex-col border border-[#333] overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-4 duration-300"
            ref={isDragging ? dragRef : undefined}
            onMouseDown={isDragging ? undefined : (e) => e.preventDefault()}
        >
            {/* Header Actions */}
            <div
                ref={dragRef}
                onMouseDown={startDrag}
                className={`bg-[#1a1a1a] p-3 border-b border-[#333] flex justify-between items-center cursor-move select-none ${isDragging ? 'cursor-grabbing' : ''}`}
                style={{ willChange: isDragging ? 'transform' : 'auto' }}
            >
                <div className="flex items-center gap-2">
                    <GripHorizontal className="w-4 h-4 text-zinc-600" />
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Claude Agent</span>
                </div>
                <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
                    <button onClick={handleCopyChat} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-white transition-colors" title="Copy Chat">
                        <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={handleClearChat} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-red-400 transition-colors" title="Clear Chat">
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={handleRestart} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-emerald-400 transition-colors" title="Restart Session">
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-px h-4 bg-zinc-800 mx-1"></div>
                    <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden relative font-sans">
                {renderContent()}
            </div>
        </div>
    );
};

export default AIAssistant;
