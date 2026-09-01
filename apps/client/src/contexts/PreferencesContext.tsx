
import React, { createContext, useContext, useState, useEffect } from "react";
import API_URL from "../config/api";
import { useAuth } from "./AuthContext";

interface PreferencesContextType {
    enableAI: boolean;
    setEnableAI: (enabled: boolean) => void;
    organizationName: string;
    setOrganizationName: (name: string) => void;
    envTagColors: Record<string, string>;
    setEnvTagColors: (colors: Record<string, string>) => void;
    envTagLabels: Record<string, string>;
    setEnvTagLabels: (labels: Record<string, string>) => void;
}

const PreferencesContext = createContext<PreferencesContextType>({} as PreferencesContextType);

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { token } = useAuth();

    // Local-only preferences
    const [enableAI, setEnableAIState] = useState<boolean>(() => {
        const stored = localStorage.getItem("enable_ai");
        return stored !== null ? stored === "true" : true;
    });

    const [organizationName, setOrganizationNameState] = useState<string>(() => {
        return localStorage.getItem("organization_name") || "";
    });

    // Server-synced preferences
    const [envTagColors, setEnvTagColorsState] = useState<Record<string, string>>({
        'staging': 'amber',
        'dev': 'blue',
        'develop': 'blue',
        'production': 'rose',
        'prod': 'rose',
        'qa': 'emerald',
        'uat': 'emerald'
    });

    const [envTagLabels, setEnvTagLabelsState] = useState<Record<string, string>>({
        'staging': 'STAGE',
        'dev': 'DEV',
        'develop': 'DEV',
        'production': 'PROD',
        'prod': 'PROD',
        'qa': 'QA',
        'uat': 'UAT'
    });

    // Load from server on mount
    useEffect(() => {
        if (!token) return;

        const loadPreferences = async () => {
            try {
                const res = await fetch(`${API_URL}/api/settings/preferences`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();

                    // Check if server data is empty but we have local data -> Migrate
                    const localColors = localStorage.getItem("env_tag_colors");
                    const localLabels = localStorage.getItem("env_tag_labels");

                    let needsMigration = false;
                    let mergedColors = data.envTagColors || {};
                    let mergedLabels = data.envTagLabels || {};

                    if (!data.envTagColors && localColors) {
                        try {
                            mergedColors = { ...mergedColors, ...JSON.parse(localColors) };
                            needsMigration = true;
                        } catch (e) { }
                    }
                    if (!data.envTagLabels && localLabels) {
                        try {
                            mergedLabels = { ...mergedLabels, ...JSON.parse(localLabels) };
                            needsMigration = true;
                        } catch (e) { }
                    }

                    if (needsMigration) {
                        // Save migration back to server
                        await fetch(`${API_URL}/api/settings/preferences`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({
                                envTagColors: mergedColors,
                                envTagLabels: mergedLabels
                            })
                        });
                        // Clear local storage after migration? No, keep as backup/cache if needed or just leave it.
                    }

                    if (data.envTagColors || needsMigration) setEnvTagColorsState(mergedColors);
                    if (data.envTagLabels || needsMigration) setEnvTagLabelsState(mergedLabels);
                }
            } catch (e) {
                console.error("Failed to load preferences", e);
            }
        };

        loadPreferences();
    }, [token]);

    const setEnableAI = (enabled: boolean) => {
        localStorage.setItem("enable_ai", String(enabled));
        setEnableAIState(enabled);
    };

    const setOrganizationName = (name: string) => {
        localStorage.setItem("organization_name", name);
        setOrganizationNameState(name);
    };

    const setEnvTagColors = (colors: Record<string, string>) => {
        setEnvTagColorsState(colors);
        // Persist to server
        if (token) {
            fetch(`${API_URL}/api/settings/preferences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ envTagColors: colors }) // Only sending colors update, careful about partial updates
            }).catch(e => console.error(e));
        }
        // Also keep local just in case? Maybe for offline start?
        localStorage.setItem("env_tag_colors", JSON.stringify(colors));
    };

    const setEnvTagLabels = (labels: Record<string, string>) => {
        setEnvTagLabelsState(labels);
        // Persist to server
        if (token) {
            fetch(`${API_URL}/api/settings/preferences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ envTagLabels: labels })
            }).catch(e => console.error(e));
        }
        localStorage.setItem("env_tag_labels", JSON.stringify(labels));
    };

    return (
        <PreferencesContext.Provider value={{
            enableAI, setEnableAI,
            organizationName, setOrganizationName,
            envTagColors, setEnvTagColors,
            envTagLabels, setEnvTagLabels
        }}>
            {children}
        </PreferencesContext.Provider>
    );
};

export const usePreferences = () => useContext(PreferencesContext);
