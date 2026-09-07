import React, { useState, useEffect, useCallback } from 'react';
import { File as FileIcon, Upload, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useToast } from '../../contexts/ToastContext';

export interface ResourceFile {
    name: string;
    path?: string;
    size: number;
    updatedAt?: string;
}

interface Props {
    /** GET, returns { files: [...] } */
    listUrl: string;
    /** POST multipart, field name `file` */
    uploadUrl: string;
    /** DELETE for one file */
    deleteUrl: (name: string) => string;
    /** Named in the delete confirmation, so it says what is actually at risk. */
    scopeLabel: string;
}

/**
 * Upload, list and delete for one scope's resources.
 *
 * One component for the instance-wide files and for a group's, because the two
 * lists differed only in their URLs and had drifted apart anyway - the global
 * one told people to use ${GLOBAL_RESOURCES}, which the runtime has never set.
 */
const ResourceManager: React.FC<Props> = ({ listUrl, uploadUrl, deleteUrl, scopeLabel }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();
    const toast = useToast();

    const [files, setFiles] = useState<ResourceFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);

    const fetchFiles = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setFiles(data.files || []);
        } catch {
            toast.error('Could not load resources');
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }, [token, listUrl]);

    useEffect(() => { fetchFiles(); }, [fetchFiles]);

    const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        const form = new FormData();
        form.append('file', file);
        try {
            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: form
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || 'Upload failed');
            }
            toast.success(`Uploaded ${file.name}`);
            await fetchFiles();
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const onDelete = async (name: string) => {
        if (!await confirm({
            title: 'Delete resource?',
            message: `Every pipeline in ${scopeLabel} loses ${name} on its next run.`,
            confirmText: 'Delete',
            isDangerous: true
        })) return;
        try {
            const res = await fetch(deleteUrl(name), {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || 'Delete failed');
            }
            await fetchFiles();
        } catch (err) {
            toast.error((err as Error).message);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
                <div className="relative h-48">
                    <input
                        type="file"
                        onChange={onUpload}
                        disabled={uploading}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center h-full transition-all ${
                        uploading
                            ? 'border-emerald-500 bg-emerald-500/5'
                            : 'border-slate-700 hover:border-emerald-500 bg-slate-900/40 hover:bg-slate-800/60'
                    }`}>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
                            uploading ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-800 text-slate-400'
                        }`}>
                            {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                        </div>
                        <p className="text-slate-300 font-medium text-center">
                            {uploading ? 'Uploading...' : 'Click or drag to upload'}
                        </p>
                        <p className="text-xs text-slate-500 mt-2 text-center">Any file type</p>
                    </div>
                </div>
            </div>

            <div className="lg:col-span-2">
                <h3 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">
                    Files in {scopeLabel}
                </h3>

                {loading && files.length === 0 ? (
                    <div className="text-slate-500 text-sm italic">Loading resources...</div>
                ) : files.length === 0 ? (
                    <div className="text-center py-8 border border-slate-800 rounded-lg bg-slate-900/20 text-slate-500 text-sm">
                        <FileIcon className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        Nothing uploaded for this scope.
                    </div>
                ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        {files.map(file => (
                            <div
                                key={file.name}
                                className="bg-black/20 border border-slate-700/50 p-3 rounded-lg flex items-center justify-between group hover:border-slate-600 hover:bg-slate-800/30 transition-all"
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center text-blue-400 font-bold text-xs uppercase shrink-0 border border-slate-700">
                                        {file.name.split('.').pop()?.substring(0, 4)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-200 truncate pr-2" title={file.name}>
                                            {file.name}
                                        </p>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                                            {(file.size / 1024).toFixed(1)} KB
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => onDelete(file.name)}
                                    className="text-slate-600 hover:text-red-400 hover:bg-red-900/20 p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    title="Delete file"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ResourceManager;
