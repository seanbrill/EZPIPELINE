/**
 * The desktop app's bridge (apps/desktop/electron/preload.cjs). Undefined in a browser:
 * everything that uses it is drawn only inside the app.
 */
export interface UpdateState {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'failed' | 'manual';
  current: string;
  version?: string;
  got?: number;
  total?: number;
  message?: string;
  mismatch?: boolean;
  page?: string;
  waiting?: boolean;
}
export interface DesktopInfo {
  version: string; electron: string; node: string; platform: string;
  mode: 'local' | 'remote' | null; where: string; server: string | null;
  dataDir: string | null; logsDir: string | null; instance: string | null; update: UpdateState;
}
export interface TrayRun { id: string; pipeline: string; number: number; step: string | null; percent: number; endedAt?: string | null }
interface Bridge {
  platform: string;
  info(): Promise<DesktopInfo>;
  update: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    cancel(): Promise<UpdateState>;
    restart(whenIdle?: boolean): Promise<UpdateState>;
    dismiss(): Promise<UpdateState>;
    onChange(cb: (s: UpdateState) => void): () => void;
  };
  reportState(s: { instance?: string; running: TrayRun[]; waiting: TrayRun[]; failed: TrayRun[] }): void;
  changeServer(): Promise<void>;
  showDataFolder(): Promise<void>;
  openExternal(url: string): Promise<void>;
}

export const desktop: Bridge | undefined = (window as unknown as { ezpDesktop?: Bridge }).ezpDesktop;
/** On a Mac the app hides the title bar and the page draws it (DesktopTitleBar). */
export const desktopMac = desktop?.platform === 'darwin';
