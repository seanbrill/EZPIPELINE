
import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    isDangerous = false,
    onConfirm,
    onCancel
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#1e1e1e] border border-slate-700/50 rounded-xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100 animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-6 pb-0 flex items-start gap-4">
                    <div className={`p-3 rounded-full flex-shrink-0 ${isDangerous ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            {message}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="p-6 flex items-center justify-end gap-3 mt-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors text-sm font-medium"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 rounded-lg text-white text-sm font-bold shadow-lg transition-all flex items-center gap-2 ${isDangerous
                                ? 'bg-red-600 hover:bg-red-500 shadow-red-900/20'
                                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20'
                            }`}
                    >
                        {isDangerous ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
