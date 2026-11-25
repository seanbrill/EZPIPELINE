/**
 * /runs/:buildId (design sheet f39, f65, f66, f58, f119; phone f123–f127).
 *
 * A URL per run, so a run can be linked, shared and gone back to. The commit
 * card is always on screen, from "Resolving commit…" onwards. The step grid
 * keeps v1's tiles; selecting a tile scopes the log to that step.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CircleStop, GitBranch, Play, RotateCcw, ShieldCheck, Undo2, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { useLive } from '../../contexts/LiveContext';
import { api } from '../../lib/api';
import { usePageChrome } from '../../components/shell/chrome';
import { NotFound, Page } from '../../components/shell/states';
import { CommitCard } from '../../components/run/CommitCard';
import { StepZoom, nameOfPath } from '../../components/run/StepZoom';
import { LogView, useRunLog } from '../../components/run/LogView';
import { FailureCard } from '../../components/run/FailureCard';
import { RunStatusBadge, runState } from '../../components/run/status';
import { TriggerPill, useRunCommit } from '../../components/run/RunRow';
import { branchOf, focusStep, runElapsed, tilesFor, useNow, useSubsteps } from '../../components/run/model';
import { useRunActions } from '../../components/run/useRunActions';
import { formatDurationCompact } from '../../helpers/formatDuration';
import { Banner, Card, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Menu } from '../../components/ui/Menu';
import type { BuildHistoryEntry, Commit, LogLine } from '../../types/build';
import { useIsPhone } from '../../hooks/useMediaQuery';

interface Pending { commits: Commit[]; branch: string | null; reason?: string }

function ApprovalModal({ run, open, onClose }: { run: BuildHistoryEntry; open: boolean; onClose: () => void }) {
  const { approve, abort } = useRunActions();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const commit = useRunCommit(run);
  useEffect(() => {
    if (!open) return;
    api<Pending>(`/pipelines/${encodeURIComponent(run.pipelineId)}/pending-commits`).then(setPending).catch(() => setPending(null));
  }, [open, run.pipelineId]);
  const going = run.commits?.length ? run.commits : pending?.commits ?? [];
  return (
    <Modal open={open} onClose={onClose} size="md" icon={<ShieldCheck />} iconTone="warn" busy={busy}
      title={run.activeStep ?? 'Approval'}
      description={<>{run.pipelineName} #{run.buildNumber} stopped here and waits for someone to let it continue.</>}
      onSubmit={async () => { setBusy(true); if (await approve(run)) onClose(); setBusy(false); }}
      footerStart={<Button variant="danger" onClick={() => { onClose(); void abort(run); }}>Cancel run</Button>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Not yet</Button>
        <Button variant="primary" loading={busy} loadingText="Approving…" onClick={async () => { setBusy(true); if (await approve(run)) onClose(); setBusy(false); }}>Approve and continue</Button>
      </>}>
      {commit && <CommitCard compact commit={{ ...commit, branch: branchOf(run.triggeredBy) }} />}
      {going.length > 1 && (
        <div className="mt-4">
          <div className="mb-2 text-[12.5px] font-medium text-fg-2">{going.length} commits go out with this run</div>
          <ul className="max-h-48 overflow-y-auto rounded-box border border-line">
            {going.map((c) => (
              <li key={c.sha} className="flex gap-3 border-b border-line px-3 py-2 text-[13px] last:border-0">
                <span className="font-mono text-fg-3">{c.shortSha ?? c.sha.slice(0, 7)}</span><span className="min-w-0 flex-1 truncate">{c.subject}</span><span className="text-fg-3">{c.author}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export default function RunPage() {
  const { buildId = '' } = useParams();
  const { history, pipelines, loaded, onEvent } = useLive();
  const phone = useIsPhone();
  const run = history.find((h) => h.id === buildId);
  const state = run ? runState(run) : null;
  const live = state === 'running' || state === 'starting' || state === 'approval';
  const now = useNow(live);
  const actions = useRunActions();
  const [approving, setApproving] = useState(false);
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  // Zoomed into a step's substeps: the node shown ("2", "2.2") and the tile selected inside it.
  const [zoom, setZoomState] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<string | null>(null);
  const setZoom = useCallback((p: string | null) => { setZoomState(p); setLeaf(null); }, []);
  const subs = useSubsteps(buildId, onEvent);
  const [jump, setJump] = useState<{ line: LogLine; n: number } | null>(null);
  // Another run: start again at the top, on the step that matters.
  const [stateFor, setStateFor] = useState(buildId);
  if (stateFor !== buildId) {
    setStateFor(buildId);
    setZoomState(null);
    setLeaf(null);
    setPicked(undefined);
    setJump(null);
  }
  const { lines, error } = useRunLog(buildId, !live);
  const commit = useRunCommit(run);
  const pipeline = run ? pipelines.find((p) => p.id === run.pipelineId) : undefined;

  usePageChrome(
    run ? [{ label: 'Runs', to: '/runs' }, { label: run.pipelineName, to: `/pipelines/${encodeURIComponent(run.pipelineId)}` }, { label: `#${run.buildNumber}` }] : [{ label: 'Runs', to: '/runs' }, { label: 'Run' }],
    run && state === 'approval' && pipeline?.permissions?.canRun !== false
      ? <Button variant="primary" icon={<ShieldCheck className="size-4" />} onClick={() => setApproving(true)}>{phone ? 'Review' : 'Review and approve'}</Button>
      : run && pipeline?.permissions?.canRun !== false && !live
        ? <Button variant="primary" icon={<Play className="size-4" />} onClick={() => pipeline && void actions.run(pipeline, { open: true })}>{phone ? 'Rerun' : 'Run again'}</Button>
        : undefined,
    [run?.id, state, phone, pipeline?.id],
  );

  const tiles = useMemo(() => (run ? tilesFor(run, now) : []), [run, now]);
  if (!loaded) return <Page><Skeleton className="h-40 w-full" rounded="rounded-card" /></Page>;
  if (!run || !state) return <NotFound />;

  const focus = focusStep(run);
  const step = zoom ? Number(zoom.split('.')[0]) - 1 : picked === undefined ? focus : picked;
  const scope = zoom ? leaf ?? zoom : null;
  const scopeName = scope ? scope.split('.').map((_, i, a) => nameOfPath(run, subs, a.slice(0, i + 1).join('.'))).join(' › ') : undefined;
  const rerunFrom = !live && canRunOf(pipeline) && step !== null && run.steps[step] && run.steps[step].type !== 'approval' ? run.steps[step].name : null;
  const el = runElapsed(run, now);
  const canRun = pipeline?.permissions?.canRun !== false;
  const anytime = run.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.type === 'action');
  const rollbackable = run.status === 'success' && (run.artifacts ?? []).some((a) => a.rollbackable);
  const failed = run.steps.find((s) => (s.status === 'failed' || s.status === 'error') && !s.continueOnError);

  return (
    <Page wide>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <RunStatusBadge state={state} />
              {run.environment && <Badge env tone={/prod/i.test(run.environment) ? 'warn' : 'neutral'}>{run.environment}</Badge>}
              <TriggerPill triggeredBy={run.triggeredBy} />
            </div>
            <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.01em]">
              <Link to={`/pipelines/${encodeURIComponent(run.pipelineId)}`} className="hover:underline">{run.pipelineName}</Link>{' '}
              <span className="font-mono text-[20px] font-normal text-fg-3">#{run.buildNumber}</span>
            </h1>
            <p className="mt-1 text-[13.5px] text-fg-2">
              {run.group ? `${run.group} · ` : ''}started {format(new Date(run.startTime), 'd MMM, HH:mm:ss')} · <span className="font-mono">{el != null ? formatDurationCompact(el) : '—'}</span>
              {live && <span className="text-run"> · live</span>}
              {failed && <span className="text-fail"> · failed at {failed.name}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {live && canRun && <Button variant="danger" icon={<CircleStop className="size-4" />} onClick={() => void actions.abort(run)}>Cancel run</Button>}
            {anytime.length > 0 && canRun && (
              <Menu title="Actions" trigger={<Button icon={<Zap className="size-4" />}>Actions</Button>}
                items={anytime.map(({ s, i }) => ({
                  label: s.name, text: s.name, hint: s.description,
                  disabled: (s.requirePriorSteps && run.steps.slice(0, i).some((p) => p.type !== 'action' && p.status !== 'success'))
                    || (s.requireLatestBuild && history.some((h) => h.pipelineId === run.pipelineId && h.buildNumber > run.buildNumber)),
                  onSelect: () => void actions.press(run, s.name, !!s.confirm),
                }))} />
            )}
            {rollbackable && canRun && <Button icon={<Undo2 className="size-4" />} onClick={() => void actions.rollback(run)}>Roll back to this</Button>}
            {!live && canRun && pipeline && <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => void actions.run(pipeline, { open: true })} className="sm:hidden">Run again</Button>}
          </div>
        </div>

        {state === 'approval' && (
          <Banner tone="warn" title={`Waiting for approval at “${run.activeStep}”`}
            action={canRun ? <Button size="sm" variant="secondary" onClick={() => setApproving(true)}>Review</Button> : undefined}>
            {canRun ? 'Nothing after this step runs until someone approves.' : 'Someone with "run" on this pipeline has to approve it.'}
          </Banner>
        )}

        {failed && !live && (
          <FailureCard run={run} index={run.steps.indexOf(failed)} lines={lines} canRun={canRun && !!pipeline}
            onRerunFrom={(name) => pipeline && void actions.run(pipeline, { open: true, fromStep: name })}
            onRerunAll={() => pipeline && void actions.run(pipeline, { open: true })}
            onJump={(line) => {
              setZoom(null);
              setPicked(run.steps.indexOf(failed));
              setJump((j) => ({ line, n: (j?.n ?? 0) + 1 }));
              document.getElementById('run-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }} />
        )}

        {commit ? (
          <CommitCard commit={{ ...commit, branch: branchOf(run.triggeredBy) }} alsoIn={(run.commits ?? []).slice(1).map((c) => ({ sha: c.sha, subject: c.subject }))} />
        ) : run.commitSha || (live && branchOf(run.triggeredBy)) ? (
          // A sha is known (or a watch fired, so one is coming): its details are on their way.
          <CommitCard resolving commit={{ sha: run.commitSha ?? '', subject: '' }} />
        ) : (
          <Card className="flex items-center gap-3 text-[13.5px] text-fg-3"><GitBranch className="size-4 shrink-0" />
            {live ? 'No commit yet. One is recorded if a step checks out a git repository.' : 'This run did not record a commit: its workspace had no git checkout.'}
          </Card>
        )}

        <StepZoom run={run} now={now} subs={subs} tiles={tiles} zoom={zoom}
          selected={zoom ? leaf : step === null ? null : String(step)}
          onZoom={setZoom}
          onSelect={(k) => (zoom ? setLeaf(k) : setPicked(k === null ? null : Number(k)))} />

        {rerunFrom && (
          <div className="-mt-2 flex justify-end">
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />}
              onClick={() => pipeline && void actions.run(pipeline, { open: true, fromStep: rerunFrom })}>
              Rerun from “{rerunFrom}”
            </Button>
          </div>
        )}

        <div id="run-log" className="scroll-mt-4" />
        <LogView className="h-[60vh] min-h-[320px]" lines={lines} error={error} step={step} scope={scope} focus={jump}
          stepName={scopeName ?? (step !== null ? run.steps[step]?.name : undefined)} fileName={`${run.pipelineId}-${run.buildNumber}.log`} />
      </div>
      <ApprovalModal run={run} open={approving} onClose={() => setApproving(false)} />
    </Page>
  );
}

function canRunOf(p: { permissions?: { canRun?: boolean } } | undefined) {
  return !!p && p.permissions?.canRun !== false;
}
