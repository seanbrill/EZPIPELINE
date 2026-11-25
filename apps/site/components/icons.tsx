// The icons the pages use, drawn as the design sheet draws them (lucide shapes, 24px grid).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: "sm" | "lg" };
const Ic = ({ size, className, children, ...p }: P & { children: React.ReactNode }) => (
  <svg className={["ic", size ? `ic-${size}` : "", className ?? ""].filter(Boolean).join(" ")} viewBox="0 0 24 24" aria-hidden="true" {...p}>{children}</svg>
);
export const Download = (p: P) => <Ic {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></Ic>;
export const Monitor = (p: P) => <Ic {...p}><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8M12 17v4" /></Ic>;
export const Terminal = (p: P) => <Ic {...p}><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></Ic>;
export const Box = (p: P) => <Ic {...p}><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12M3.3 7l8.7 5 8.7-5" /></Ic>;
export const Copy = (p: P) => <Ic {...p}><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Ic>;
export const Check = (p: P) => <Ic {...p}><path d="M20 6 9 17l-5-5" /></Ic>;
export const Arrow = (p: P) => <Ic {...p}><path d="M5 12h14M12 5l7 7-7 7" /></Ic>;
export const Cloud = (p: P) => <Ic {...p}><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></Ic>;
export const Shield = (p: P) => <Ic {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></Ic>;
export const ChevronDown = (p: P) => <Ic {...p}><path d="m6 9 6 6 6-6" /></Ic>;
export const ChevronRight = (p: P) => <Ic {...p}><path d="m9 18 6-6-6-6" /></Ic>;
export const External = (p: P) => <Ic {...p}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Ic>;
export const Info = (p: P) => <Ic {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></Ic>;
export const Book = (p: P) => <Ic {...p}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></Ic>;
export const GitHub = (p: P) => <Ic {...p}><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></Ic>;
/** Windows: four panes, as the sheet draws it. */
export const Windows = () => <span className="win4" aria-hidden="true"><i></i><i></i><i></i><i></i></span>;

/** The logo (f37). */
export const Mark = ({ size, className = "mark" }: { size?: number; className?: string }) => (
  <svg className={className} viewBox="0 0 32 32" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
    <rect width="32" height="32" rx="9" fill="#10b981" />
    <path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23" fill="none" stroke="#022c22" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.5 16H20.5L16 22.5H25" fill="none" stroke="#ecfdf5" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6.5" cy="16" r="2.3" fill="#022c22" /><circle cx="6.5" cy="16" r="1.15" fill="#ecfdf5" />
    <circle cx="20.5" cy="16" r="2.3" fill="#022c22" /><circle cx="20.5" cy="16" r="1.15" fill="#ecfdf5" />
    <circle cx="25" cy="22.5" r="2.65" fill="#022c22" /><circle cx="25" cy="22.5" r="1.5" fill="#ecfdf5" />
  </svg>
);
export const Logo = () => <span className="logo"><Mark /><span><b>EZ</b>Pipeline</span></span>;
export const Search = (p: P) => <Ic {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Ic>;
export const Pencil = (p: P) => <Ic {...p}><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Ic>;
export const Star = (p: P) => <Ic {...p}><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></Ic>;
export const Folder = (p: P) => <Ic {...p}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Ic>;
export const Users = (p: P) => <Ic {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Ic>;
export const ShieldAlert = (p: P) => <Ic {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 8v4M12 16h.01" /></Ic>;
export const Warning = (p: P) => <Ic {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></Ic>;
