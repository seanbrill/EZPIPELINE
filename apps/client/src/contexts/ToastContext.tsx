import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import Toast from '../components/common/Toast';

interface ToastOptions {
    duration?: number;
}

interface ToastMessage {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    duration?: number;
}

interface ToastContextType {
    success: (message: string, options?: ToastOptions) => void;
    error: (message: string, options?: ToastOptions) => void;
    warning: (message: string, options?: ToastOptions) => void;
    info: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = useCallback((type: ToastMessage['type'], message: string, options?: ToastOptions) => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts(prev => [...prev, { id, type, message, duration: options?.duration }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const success = useCallback((message: string, options?: ToastOptions) => addToast('success', message, options), [addToast]);
    const error = useCallback((message: string, options?: ToastOptions) => addToast('error', message, options), [addToast]);
    const warning = useCallback((message: string, options?: ToastOptions) => addToast('warning', message, options), [addToast]);
    const info = useCallback((message: string, options?: ToastOptions) => addToast('info', message, options), [addToast]);

    return (
        <ToastContext.Provider value={{ success, error, warning, info }}>
            {children}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end pointer-events-none w-full max-w-sm">
                <div className="pointer-events-auto w-full">
                    {toasts.map(toast => (
                        <Toast
                            key={toast.id}
                            {...toast}
                            onDismiss={removeToast}
                        />
                    ))}
                </div>
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
