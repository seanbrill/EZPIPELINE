export interface Build {
  id: string; // Changed from number to string for UUID
  target: string;
  status: 'running' | 'success' | 'failed' | 'aborted' | 'error' | 'paused';
  steps: string[];
  activeStep?: string;
  version: string;
  percentage: number;
  started: Date;
  isAborted: boolean;
  ended?: Date;
  error?: string;
  stepTimings?: Record<string, { start: number; end?: number; duration?: number; status: string; continueOnError?: boolean }>;
}
