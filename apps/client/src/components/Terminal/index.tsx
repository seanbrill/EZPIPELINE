import React, { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Ansi from 'ansi-to-react';
import API_URL from '../../config/api';

interface TerminalProps {
    socket: any; // Socket.IO socket
}

const Terminal: React.FC<TerminalProps> = ({ socket }) => {
    const { token } = useAuth();
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [output, setOutput] = useState<string[]>([]);
    const [input, setInput] = useState('');
    const [hasAccess, setHasAccess] = useState<boolean | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Check access on mount
    useEffect(() => {
        checkAccess();
    }, [token]);

    // Setup socket listeners
    useEffect(() => {
        if (!socket) return;

        socket.on('terminal-output', (data: { sessionId: string, data: string }) => {
            if (data.sessionId === sessionId) {
                setOutput(prev => [...prev, data.data]);
            }
        });

        socket.on('terminal-exit', (data: { sessionId: string, code: number }) => {
            if (data.sessionId === sessionId) {
                setOutput(prev => [...prev, `\n\x1b[33mProcess exited with code ${data.code}\x1b[0m\n`]);
                setSessionId(null);
            }
        });

        socket.on('terminal-error', (data: { sessionId: string, error: string }) => {
            if (data.sessionId === sessionId) {
                setOutput(prev => [...prev, `\x1b[31mError: ${data.error}\x1b[0m\n`]);
            }
        });

        return () => {
            socket.off('terminal-output');
            socket.off('terminal-exit');
            socket.off('terminal-error');
        };
    }, [socket, sessionId]);

    // Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [output]);

    const checkAccess = async () => {
        try {
            const res = await fetch(`${API_URL}/api/terminal/check-access`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setHasAccess(data.hasAccess);
        } catch (err) {
            console.error('Failed to check terminal access', err);
            setHasAccess(false);
        }
    };

    const createSession = async () => {
        if (!socket) return;

        try {
            const res = await fetch(`${API_URL}/api/terminal/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ socketId: socket.id })
            });

            const data = await res.json();
            if (data.success) {
                setSessionId(data.sessionId);
                setOutput([]);
            }
        } catch (err) {
            console.error('Failed to create terminal session', err);
        }
    };

    const sendInput = async () => {
        if (!sessionId || !input.trim()) return;

        try {
            await fetch(`${API_URL}/api/terminal/input`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ sessionId, input: input + '\n' })
            });

            setInput('');
        } catch (err) {
            console.error('Failed to send input', err);
        }
    };

    const killSession = async () => {
        if (!sessionId) return;

        try {
            await fetch(`${API_URL}/api/terminal/kill`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ sessionId })
            });

            setSessionId(null);
            setOutput([]);
        } catch (err) {
            console.error('Failed to kill session', err);
        }
    };

    if (hasAccess === null) {
        return <div className="flex items-center justify-center h-full text-slate-400">Checking access...</div>;
    }

    if (!hasAccess) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <TerminalIcon className="w-12 h-12 text-slate-600 mb-3" />
                <h3 className="text-lg font-semibold text-slate-300 mb-2">Terminal Access Denied</h3>
                <p className="text-sm text-slate-500">You do not have permission to use the terminal.</p>
            </div>
        );
    }

    if (!sessionId) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <button
                    onClick={createSession}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                    <TerminalIcon className="w-5 h-5" />
                    Start Terminal Session
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0d1117] font-mono text-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-700">
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <TerminalIcon className="w-4 h-4" />
                    <span>Terminal Session</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={killSession}
                        className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-red-400 transition-colors"
                        title="End Session"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Output */}
            <div className="flex-1 overflow-y-auto p-4 space-y-0.5 custom-scrollbar">
                {output.map((line, i) => (
                    <div key={i} className="text-slate-300 break-words leading-5">
                        <Ansi>{line}</Ansi>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-slate-900/50 border-t border-slate-700 flex gap-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            sendInput();
                        }
                    }}
                    placeholder="Type command and press Enter..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none"
                    autoFocus
                />
            </div>
        </div>
    );
};

export default Terminal;
