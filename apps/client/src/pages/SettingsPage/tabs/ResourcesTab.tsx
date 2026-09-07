import React, { useState } from 'react';
import { File as FileIcon } from 'lucide-react';
import ResourceManager from '../../../components/Shared/ResourceManager';
import ScopeTabs, { GLOBAL_SCOPE } from '../../../components/Shared/ScopeTabs';
import useGroups from '../../../hooks/useGroups';
import API_URL from '../../../config/api';

const ResourcesTab: React.FC = () => {
    const { groups, error } = useGroups();
    const [scope, setScope] = useState<string>(GLOBAL_SCOPE);
    const isGlobal = scope === GLOBAL_SCOPE;
    const g = encodeURIComponent(scope);

    return (
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 shadow-sm backdrop-blur-sm animate-in fade-in duration-500">
            <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
                <FileIcon className="w-5 h-5 text-blue-500" />
                Resources
            </h2>

            <p className="text-sm text-slate-400 mb-4 max-w-3xl">
                {isGlobal
                    ? <>Files copied into <strong>every</strong> pipeline's workspace.</>
                    : <>Files copied into the workspace of every pipeline in <strong>{scope}</strong>, and no other group.</>}
                {' '}Layers are copied instance first, then each group from the outside in,
                then the pipeline's own, so the most specific file of a given name wins.
            </p>

            <p className="text-sm text-slate-400 mb-6 max-w-3xl bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg">
                <span className="font-bold text-blue-400">Reference them as</span>{' '}
                <code className="text-blue-300">{`\${RESOURCES/filename}`}</code>.
                {' '}Every layer lands in that one directory, so a step does not need to know
                which scope a file came from. This panel used to say{' '}
                <code>{`\${GLOBAL_RESOURCES}`}</code>, which the runtime has never set.
            </p>

            <div className="mb-6">
                <ScopeTabs
                    scope={scope}
                    groups={groups}
                    onChange={setScope}
                    emptyHint="No groups yet. Pipelines filed in a folder get one."
                />
                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            </div>

            <ResourceManager
                key={scope}
                scopeLabel={isGlobal ? 'every pipeline' : scope}
                listUrl={isGlobal
                    ? `${API_URL}/api/config/global-resources`
                    : `${API_URL}/api/config/group-resources/${g}`}
                uploadUrl={isGlobal
                    ? `${API_URL}/api/config/global-resources/upload`
                    : `${API_URL}/api/config/group-resources/${g}/upload`}
                deleteUrl={(name) => isGlobal
                    ? `${API_URL}/api/config/global-resources/${encodeURIComponent(name)}`
                    : `${API_URL}/api/config/group-resources/${g}/${encodeURIComponent(name)}`}
            />
        </div>
    );
};

export default ResourcesTab;
