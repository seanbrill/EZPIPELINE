import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';

export interface ToastProps {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    onDismiss: (id: string) => void;
    duration?: number;
}

const Toast: React.FC<ToastProps> = ({ id, type, message, onDismiss, duration = 3000 }) => {
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsExiting(true);
            setTimeout(() => onDismiss(id), 300); // Wait for exit animation
        }, duration);

        return () => clearTimeout(timer);
    }, [id, duration, onDismiss]);

    const handleDismiss = () => {
        setIsExiting(true);
        setTimeout(() => onDismiss(id), 300);
    };

    const icons = {
        success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
        error: <XCircle className="w-5 h-5 text-red-400" />,
        warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
        info: <Info className="w-5 h-5 text-blue-400" />
    };

    const styles = {
        success: 'border-emerald-500/50 bg-emerald-950/90 text-emerald-50',
        error: 'border-red-500/50 bg-red-950/90 text-red-50',
        warning: 'border-yellow-500/50 bg-yellow-950/90 text-yellow-50',
        info: 'border-blue-500/50 bg-blue-950/90 text-blue-50'
    };

    return (
        <div
            className={`
                flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md mb-2 transition-all duration-300 transform
                ${styles[type]}
                ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
                animate-in slide-in-from-right fade-in
            `}
            role="alert"
        >
            <div className="flex-shrink-0">{icons[type]}</div>
            <p className="text-sm font-medium pr-2">{message}</p>
            <button
                onClick={handleDismiss}
                className="ml-auto flex-shrink-0 p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-white/10 transition-colors"
                aria-label="Close"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
};

export default Toast;
