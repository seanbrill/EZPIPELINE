import React, { useState } from 'react';
import { X, FolderPlus } from 'lucide-react';

interface CreateGroupModalProps {
    parentPath?: string;
    onClose: () => void;
    onConfirm: (groupName: string) => void;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ parentPath, onClose, onConfirm }) => {
    const [name, setName] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const trimmed = name.trim();
        if (!trimmed) {
            setError("Folder name cannot be empty");
            return;
        }

        if (/[^a-zA-Z0-9\-_ ]/.test(trimmed)) {
            setError("Folder name contains invalid characters");
            return;
        }

        onConfirm(trimmed);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#1e1e1e] rounded-xl border border-slate-700 shadow-2xl w-full max-w-sm flex flex-col">
                <div className="flex justify-between items-center p-4 border-b border-slate-700">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <FolderPlus className="w-5 h-5 text-emerald-500" />
                        Create Folder
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {parentPath && (
                        <div className="text-xs text-slate-500 bg-slate-900/50 p-2 rounded">
                            Creating in: <span className="font-mono text-emerald-400">{parentPath}</span>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Folder Name</label>
                        <input
                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-white focus:border-emerald-500 outline-none"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="New Folder"
                            autoFocus
                        />
                    </div>

                    {error && <p className="text-red-400 text-sm">{error}</p>}

                    <div className="flex justify-end pt-4">
                        <button
                            type="submit"
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-lg shadow-emerald-900/20"
                        >
                            Create Folder
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateGroupModal;
