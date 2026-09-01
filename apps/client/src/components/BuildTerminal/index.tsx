import React, { useEffect, useRef } from 'react';
import { CheckCircle2, Circle, XCircle, Loader2, Terminal as TerminalIcon } from 'lucide-react';

interface BuildTerminalProps {
    logs: string[];
    steps?: string[];
    activeStep?: string;
    buildStatus?: 'running' | 'completed' | 'error' | 'aborted';
}

const BuildTerminal: React.FC<BuildTerminalProps> = ({ logs, steps = [], activeStep, buildStatus = 'running' }) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (buildStatus === 'running') {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, buildStatus]);

    const getStepStatus = (stepName: string, index: number) => {
        if (!activeStep) return 'pending';
        // If whole build is completed, everything is completed
        if (buildStatus === 'completed') return 'completed';
        if (buildStatus === 'aborted') return activeStep === stepName ? 'aborted' : 'pending';

        const activeIndex = steps.indexOf(activeStep);
        if (index < activeIndex) return 'completed';
        if (index === activeIndex) return buildStatus === 'error' ? 'error' : 'running';
        return 'pending';
    };

    return (
        <div className="flex h-full border border-slate-700 rounded-lg overflow-hidden bg-[#0d1117] shadow-inner font-mono text-sm max-h-full">
            {/* Steps Sidebar - Only if we have steps */}
            {steps.length > 0 && (
                <div className="w-64 border-r border-slate-700 bg-slate-900/50 flex flex-col flex-shrink-0">
                    <div className="p-3 border-b border-slate-700 font-bold text-slate-400 text-xs uppercase tracking-wider flex items-center gap-2 bg-slate-800/50">
                        <TerminalIcon className="w-4 h-4" /> Steps ({steps.length})
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {steps.map((step, i) => {
                            const status = getStepStatus(step, i);
                            return (
                                <div key={step} className={`
                                    flex items-center gap-3 px-3 py-2 rounded transition-colors text-xs font-medium
                                    ${status === 'running' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : ''}
                                    ${status === 'completed' ? 'text-green-400' : ''}
                                    ${status === 'error' ? 'text-red-400 bg-red-500/10 border border-red-500/20' : ''}
                                    ${status === 'pending' ? 'text-slate-500' : ''}
                                    ${status === 'aborted' ? 'text-orange-400' : ''}
                                `}>
                                    {status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
                                    {status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
                                    {status === 'error' && <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                                    {(status === 'pending' || status === 'aborted') && <Circle className="w-3.5 h-3.5 opacity-20 flex-shrink-0" />}
                                    <span className="truncate">{step}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Logs Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-[#0d1117] h-full overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 space-y-0.5 custom-scrollbar">
                    {logs.length === 0 && <div className="text-slate-500 italic p-4">Waiting for logs...</div>}
                    {logs.map((log, i) => (
                        <div key={i} className="text-slate-300 break-words font-mono text-xs leading-5 hover:bg-slate-800/30 -mx-4 px-4 flex gap-2">
                            <span className="text-slate-600 select-none w-8 text-right flex-shrink-0 opacity-50">{(i + 1)}</span>
                            <span className="whitespace-pre-wrap">{log}</span>
                        </div>
                    ))}
                    <div ref={bottomRef} className="h-4" />
                </div>
            </div>
        </div>
    );
};

export default BuildTerminal;
