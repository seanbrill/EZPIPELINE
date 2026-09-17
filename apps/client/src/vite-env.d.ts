/// <reference types="vite/client" />

// The build stamp injected by the appVersionPlugin in vite.config.ts. It is a
// virtual module rather than a file, so TypeScript needs telling it exists.
declare module 'virtual:app-version' {
  const stamp: { build: number; commit: string; branch: string };
  export default stamp;
}
