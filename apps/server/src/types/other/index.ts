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
  /**
   * This run may pass approval gates without a human.
   *
   * It lives ON THE BUILD rather than in run()'s options because approveBuild
   * resumes with `run(build.target, build)` and passes no options at all. A
   * flag held only in the arguments would survive the first gate and be lost
   * before the second, so a two-gate pipeline would auto-approve once and then
   * wait forever for a click nobody knew to make.
   *
   * Set only by a git watch with auto-approve enabled.
   */
  autoApprove?: boolean;
}
