import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import API_URL from '../config/api';

/**
 * The groups that exist, as scopes you can configure.
 *
 * A pipeline's `group` is its parent directory relative to the pipelines root,
 * so provision-dev reports `Notch.fm/Infra` and deploy-dev reports `Notch.fm`.
 * Listing only what pipelines report would offer `Notch.fm/Infra` and not
 * `Notch.fm`, and `Notch.fm` is the one worth putting a subscription id on -
 * so every ancestor is included, not just the leaf.
 *
 * `General` is the name given to pipelines filed at the root. It is a display
 * label rather than a directory, so there is nowhere to write its config.
 */
export function useGroups() {
    const { token } = useAuth();
    const [groups, setGroups] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            // /api/targets. There is no /api/pipelines - asking for one gets
            // the SPA's index.html back with a 200, which fails as JSON.
            const res = await fetch(`${API_URL}/api/targets`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error(`targets: ${res.status}`);
            const data = await res.json();
            const list = (Array.isArray(data) ? data : data.targets ?? []) as Array<{ group?: string }>;

            const found = new Set<string>();
            for (const p of list) {
                if (!p.group || p.group === 'General') continue;
                const parts = p.group.split('/').filter(Boolean);
                for (let i = 1; i <= parts.length; i++) {
                    found.add(parts.slice(0, i).join('/'));
                }
            }
            setGroups([...found].sort());
            setError(null);
        } catch (e) {
            setError('Could not load the group list');
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { refresh(); }, [refresh]);

    return { groups, error, loading, refresh };
}

export default useGroups;
