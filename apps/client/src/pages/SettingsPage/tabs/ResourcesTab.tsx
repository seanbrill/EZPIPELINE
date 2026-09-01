import React, { useState, useEffect } from 'react';
import { File as FileIcon, Download, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useConfirm } from '../../../contexts/ConfirmationContext';
import { useToast } from '../../../contexts/ToastContext';

import API_URL from '../../../config/api';

const ResourcesTab: React.FC = () => {
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    return (
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm animate-in fade-in duration-500">
            <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                <FileIcon className="w-5 h-5 text-blue-500" />
                Global Resources
            </h2>
            <p className="text-sm text-slate-400 mb-6 max-w-2xl bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg">
                <span className="font-bold text-blue-400">Tip:</span> Files uploaded here can be referenced in any pipeline using <code>{`\${GLOBAL_RESOURCES}/filename`}</code>.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                    <GlobalResourceUploader onSuccess={() => setRefreshTrigger(prev => prev + 1)} />
                </div>
                <div className="lg:col-span-2">
                    <h3 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Uploaded Files</h3>
                    <GlobalResourceList refreshTrigger={refreshTrigger} />
                </div>
            </div>
        </div>
    );
};

const GlobalResourceUploader = ({ onSuccess }: { onSuccess: () => void }) => {
    const { token } = useAuth();
    const [uploading, setUploading] = useState(false);
    const toast = useToast();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API_URL}/api/config/global-resources/upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });
            if (res.ok) {
                onSuccess();
            } else {
                toast.error("Upload failed");
            }
        } catch (e) {
            console.error(e);
            toast.error("Upload failed");
        } finally {
            setUploading(false);
            e.target.value = ''; // Reset
        }
    };

    return (
        <div className="relative h-48">
            <input
                type="file"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                disabled={uploading}
            />
            <div className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center transition-all h-full ${uploading
                ? 'border-emerald-500 bg-emerald-500/5'
                : 'border-slate-700 hover:border-emerald-500 bg-slate-900/40 hover:bg-slate-800/60'
                }`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors mb-4 ${uploading ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-800 text-slate-400 group-hover:text-emerald-500'
                    }`}>
                    {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
                </div>
                <p className="text-slate-300 font-medium text-center">{uploading ? "Uploading..." : "Click or Drag to Upload"}</p>
                <p className="text-xs text-slate-500 mt-2 text-center">Supports any file type</p>
            </div>
        </div>
    );
};

const GlobalResourceList = ({ refreshTrigger }: { refreshTrigger: number }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();
    const toast = useToast();
    const [resources, setResources] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchResources = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/config/global-resources`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setResources(data.files || []);
        } catch (e) {
            console.error("Failed to fetch global resources");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchResources();
    }, [token, refreshTrigger]);

    const deleteResource = async (name: string) => {
        if (!await confirm({
            title: `Delete Resource?`,
            message: `Are you sure you want to delete ${name}?`,
            confirmText: "Delete",
            isDangerous: true
        })) return;

        try {
            await fetch(`${API_URL}/api/config/global-resources/${name}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchResources();
        } catch (e) {
            toast.error("Failed to delete");
        }
    };

    if (loading && resources.length === 0) return <div className="text-slate-500 text-sm italic">Loading resources...</div>;

    if (resources.length === 0) return (
        <div className="text-center py-8 border border-slate-800 rounded-lg bg-slate-900/20 text-slate-500 text-sm">
            <FileIcon className="w-8 h-8 mx-auto mb-2 opacity-20" />
            No uploaded resources found.
        </div>
    );

    return (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {resources.map((file: any) => (
                <div key={file.name} className="bg-black/20 border border-slate-700/50 p-3 rounded-lg flex items-center justify-between group hover:border-slate-600 hover:bg-slate-800/30 transition-all">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center text-blue-400 font-bold text-xs uppercase shrink-0 border border-slate-700">
                            {file.name.split('.').pop()?.substring(0, 4)}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-200 truncate pr-2" title={file.name}>{file.name}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider">{(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                    </div>
                    <button
                        onClick={() => deleteResource(file.name)}
                        className="text-slate-600 hover:text-red-400 hover:bg-red-900/20 p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Delete File"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>
    );
}

export default ResourcesTab;
