// API URL configuration
// In production, API is served from same origin (relative path)
// In development, API is on different port (read from config)
const API_URL = import.meta.env.PROD
    ? ''
    : `http://localhost:${import.meta.env.VITE_SERVER_PORT || '5001'}`;

export default API_URL;
