/**
 * Starting, stopping and approving runs, with the toasts that say what happened.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useLive } from '../../contexts/LiveContext';
import type { BuildHistoryEntry, PipelineInfo } from '../../types/build';

export function useRunActions() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const { refresh } = useLive();
  const nav = useNavigate();

  const run = useCallback(async (p: Pick<PipelineInfo, 'id' | 'appName' | 'requireConfirmation' | 'environment'>, opts: { open?: boolean; fromStep?: string } = {}) => {
    // The server refuses an unconfirmed run of such a pipeline (POST /run-pipeline).
    if (p.requireConfirmation && !(await confirm({
      title: opts.fromStep ? `Rerun ${p.appName} from “${opts.fromStep}”?` : `Run ${p.appName}?`,
      message: p.environment ? `This pipeline deploys to ${p.environment}.` : 'This pipeline asks to be confirmed before it runs.',
      confirmText: 'Run pipeline',
    }))) return null;
    try {
      const r = await api<{ buildId?: string }>('/run-pipeline', { body: { target: p.id, ...(opts.fromStep ? { fromStep: opts.fromStep } : {}), ...(p.requireConfirmation ? { confirmed: true } : {}) } });
      toast.running(opts.fromStep ? `${p.appName} rerunning from ${opts.fromStep}` : `${p.appName} started`, r.buildId ? { action: { label: 'Open', onClick: () => nav(`/runs/${r.buildId}`) } } : undefined);
      void refresh();
      if (opts.open && r.buildId) nav(`/runs/${r.buildId}`);
      return r.buildId ?? null;
    } catch (e) {
      toast.error(`Could not start ${p.appName}`, { description: (e as Error).message });
      return null;
    }
  }, [confirm, toast, refresh, nav]);

  const abort = useCallback(async (b: BuildHistoryEntry) => {
    if (!(await confirm({
      title: `Cancel ${b.pipelineName} #${b.buildNumber}?`,
      message: 'The running step is stopped (its cleanup traps get a few seconds), and nothing after it runs.',
      confirmText: 'Cancel run', cancelText: 'Keep running', isDangerous: true,
    }))) return;
    try {
      await api(`/builds/${b.id}/abort`, { method: 'POST' });
      toast.info(`${b.pipelineName} #${b.buildNumber} cancelled`);
      void refresh();
    } catch (e) {
      toast.error('Could not cancel the run', { description: (e as Error).message });
    }
  }, [confirm, toast, refresh]);

  const approve = useCallback(async (b: BuildHistoryEntry) => {
    try {
      await api(`/builds/${b.id}/approve`, { method: 'POST' });
      toast.success(`Approved · ${b.pipelineName} #${b.buildNumber} continues`);
      void refresh();
      return true;
    } catch (e) {
      toast.error('Could not approve', { description: (e as Error).message });
      void refresh();
      return false;
    }
  }, [toast, refresh]);

  const press = useCallback(async (b: BuildHistoryEntry, step: string, ask: boolean) => {
    if (ask && !(await confirm({ title: `${step}?`, message: `On ${b.pipelineName} #${b.buildNumber}.`, confirmText: step }))) return;
    try {
      await api(`/builds/${b.id}/action`, { body: { step } });
      toast.running(`${step} started`);
      void refresh();
    } catch (e) {
      toast.error(`${step} failed to start`, { description: (e as Error).message });
    }
  }, [confirm, toast, refresh]);

  const rollback = useCallback(async (b: BuildHistoryEntry) => {
    if (!(await confirm({
      title: `Roll back to ${b.pipelineName} #${b.buildNumber}?`,
      message: 'A new run deploys the images this run built. Nothing is rebuilt.',
      confirmText: 'Roll back', isDangerous: true,
    }))) return;
    try {
      // Asked just above, so it is confirmed (a pipeline that requires it is refused without).
      const r = await api<{ buildId?: string }>(`/builds/${b.id}/rollback`, { method: 'POST', body: { confirmed: true } });
      toast.running('Rollback started', r.buildId ? { action: { label: 'Open', onClick: () => nav(`/runs/${r.buildId}`) } } : undefined);
      void refresh();
    } catch (e) {
      toast.error('Could not roll back', { description: (e as Error).message });
    }
  }, [confirm, toast, refresh, nav]);

  return { run, abort, approve, press, rollback };
}
