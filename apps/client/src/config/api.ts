// Where the browser should send API calls.
//
// In production the API serves this bundle, so a relative path is right.
//
// In development it is on its own port, and the HOST has to come from the
// address the page was actually opened on rather than from a constant. This
// read "http://localhost:5001", which is correct in exactly one case: the
// browser running on the same machine as Docker. Open the UI from a phone on
// the same wifi and "localhost" means the phone, so the page loads and every
// request fails against nothing at all.
//
// window.location.hostname is whatever got you here - localhost, a LAN IP, or
// a hostname - and the API is published on the same host either way.
const API_URL = import.meta.env.PROD
    ? ''
    : `${window.location.protocol}//${window.location.hostname}:${import.meta.env.VITE_SERVER_PORT || '5001'}`;

export default API_URL;
