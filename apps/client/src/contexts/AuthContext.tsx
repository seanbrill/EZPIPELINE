import React, { createContext, useContext, useState, useEffect } from "react";
import API_URL from '../config/api';

interface AuthContextType {
    user: string | null;
    token: string | null;
    isAdmin: boolean;
    login: (token: string, username: string, isAdmin: boolean) => void;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<string | null>(localStorage.getItem("user"));
    const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
    const [isAdmin, setIsAdmin] = useState<boolean>(localStorage.getItem("isAdmin") === 'true');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const initAuth = async () => {
            let currentToken = token;

            // 1. Validate existing token (if any)
            if (currentToken) {
                try {
                    const res = await fetch(`${API_URL}/api/check-auth`, {
                        headers: { Authorization: `Bearer ${currentToken}` }
                    });
                    if (!res.ok) {
                        throw new Error("Token invalid");
                    }
                } catch (e) {
                    console.warn("Token validation failed, clearing session:", e);
                    logout(); // Clears state
                    currentToken = null; // Mark as null for next step
                }
            }

            // 2. If no valid token, check if we should auto-login
            if (!currentToken) {
                try {
                    const configRes = await fetch(`${API_URL}/api/auth/config`);
                    if (configRes.ok) {
                        const config = await configRes.json();
                        if (!config.required) {
                            console.log("Auth not required, attempting anonymous login...");
                            const loginRes = await fetch(`${API_URL}/api/auth/anonymous`, { method: 'POST' });
                            const data = await loginRes.json();
                            if (data.token) {
                                login(data.token, data.user, data.isAdmin);
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Auth config check failed:", e);
                }
            }

            setIsLoading(false);
        };

        initAuth();
    }, []);

    const login = (newToken: string, newUser: string, newIsAdmin: boolean) => {
        localStorage.setItem("token", newToken);
        localStorage.setItem("user", newUser);
        localStorage.setItem("isAdmin", String(newIsAdmin));
        setToken(newToken);
        setUser(newUser);
        setIsAdmin(newIsAdmin);
    };

    const logout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        localStorage.removeItem("isAdmin");
        setToken(null);
        setUser(null);
        setIsAdmin(false);
    };

    return (
        <AuthContext.Provider value={{ user, token, isAdmin, login, logout, isAuthenticated: !!token, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
