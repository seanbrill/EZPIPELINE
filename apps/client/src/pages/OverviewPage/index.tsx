/**
 * / (design sheet f3; phone f118): what needs a person, what is running, what
 * just happened, and how each group is doing.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ShieldAlert } from 'lucide-react';
import { useLive } from '../../contexts/LiveContext';
import { usePageChrome } from '../../components/shell/chrome';
import { Page, PageHeader } from '../../components/shell/states';
import { useRunsSummary } from '../../components/shell/useRuns';
import { RunPipelineButton } from '../../components/run/RunPipelineButton';
import { RunCard, RunRow, useRunCommit } from '../../components/run/RunRow';
import { runState } from '../../components/run/status';
import { formatDurationCompact } from '../../helpers/formatDuration';
import { Banner, Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { buttonClass } from '../../components/ui/Button';
import { cx } from '../../components/ui/cx';
import { useIsPhone } from '../../hooks/useMediaQuery';
import type { BuildHistoryEntry } from '../../types/build';
import { useNow } from '../../components/run/model';
import { GettingStarted } from '../../components/onboarding/GettingStarted';

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="flex flex-col gap-1 !p-4">
      <span className="text-[12.5px] text-fg-3">{label}</span>
      <span className={cx('font-mono text-[24px] font-semibold tracking-[-0.02em]', tone)}>{value}</span>
      {sub && <span className="text-[12px] text-fg-3">{sub}</span>}
    </Card>
  );
}

function WaitingBanner({ r }: { r: BuildHistoryEntry }) {
  const c = useRunCommit(r);
  return (
    <Banner tone="warn" title={<>{r.pipelineName} #{r.buildNumber} needs you</>}
      action={<Link to={`/runs/${r.id}`} className={buttonClass('secondary', 'sm')}>Review</Link>}>
      Waiting at “{r.activeStep}”{c ? <> · <span className="font-mono">{c.shortSha}</span> {c.subject}</> : null}
    </Banner>
  );
}

export default function OverviewPage() {
  usePageChrome([{ label: 'Overview' }], <RunPipelineButton />);
  const phone = useIsPhone();
  const { loaded, pipelines } = useLive();
  const { runs, live, groups, lastByPipeline } = useRunsSummary();

  // Ticks once a minute, so "today" and "this week" move on while the page stays open.
  const now = useNow(true, 60_000);
  const stats = useMemo(() => {
    const dayAgo = now - 24 * 3600e3;
    const weekAgo = now - 7 * 24 * 3600e3;
    const today = runs.filter((r) => Date.parse(r.startTime) > dayAgo);
    const week = runs.filter((r) => Date.parse(r.startTime) > weekAgo && ['success', 'failed', 'error'].includes(r.status));
    const ok = week.filter((r) => r.status === 'success');
    const durs = ok.map((r) => r.duration ?? 0).filter(Boolean).sort((a, b) => a - b);
    return {
      today: today.length,
      failedToday: today.filter((r) => runState(r) === 'failed').length,
      rate: week.length ? Math.round((ok.length / week.length) * 100) : null,
      median: durs.length ? durs[Math.floor(durs.length / 2)] : null,
    };
  }, [runs, now]);

  if (!loaded) return <Page><Skeleton className="h-24 w-full" rounded="rounded-card" /></Page>;
  const waiting = runs.filter((r) => r.status === 'paused');
  const recent = runs.slice(0, 8);

  return (
    <Page>
      {!phone && <PageHeader title="Overview" description={`${pipelines.length} pipelines in ${groups.length} groups.`} />}
      <div className="flex flex-col gap-6">
        {waiting.length > 0 && <div className="flex flex-col gap-2">{waiting.map((r) => <WaitingBanner key={r.id} r={r} />)}</div>}
        <GettingStarted />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Running now" value={String(live)} tone={live ? 'text-run' : undefined} sub={waiting.length ? `${waiting.length} waiting for approval` : undefined} />
          <Stat label="Runs, last 24h" value={String(stats.today)} sub={stats.failedToday ? `${stats.failedToday} failed` : 'none failed'} />
          <Stat label="Success rate, 7 days" value={stats.rate == null ? '—' : `${stats.rate}%`} tone={stats.rate != null && stats.rate < 80 ? 'text-warn' : undefined} />
          <Stat label="Median successful run" value={stats.median == null ? '—' : formatDurationCompact(stats.median)} sub="last 7 days" />
        </div>

        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Recent runs</h2>
            <Link to="/runs" className="text-[13px] text-fg-2 hover:text-fg">All runs →</Link>
          </div>
          {recent.length === 0 ? (
            <Card pad={false}><EmptyState icon={<Activity />} title="Nothing has run yet" action={<RunPipelineButton />}>Runs show up here, live, the moment they start.</EmptyState></Card>
          ) : phone ? (
            <div className="flex flex-col gap-2.5">{recent.map((r) => <RunCard key={r.id} r={r} />)}</div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">{recent.map((r) => <RunRow key={r.id} r={r} />)}</div>
          )}
        </section>

        {groups.length > 0 && (
          <section>
            <h2 className="mb-2.5 text-[15px] font-semibold">Groups</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g) => {
                const ps = pipelines.filter((p) => ((p.group ?? '').split('/')[0] || 'Ungrouped') === g.name);
                return (
                  <Link key={g.name} to={g.name === 'Ungrouped' ? '/pipelines' : `/groups/${encodeURIComponent(g.name)}`} className="rounded-card border border-line bg-surface p-4 hover:border-line-2">
                    <div className="flex items-center gap-2">
                      {g.last === 'approval' ? <ShieldAlert className="size-4 text-warn" /> : <span className={cx('size-2.5 rounded-full', g.last === 'failed' ? 'bg-fail' : g.last === 'running' ? 'bg-run' : g.last ? 'bg-primary' : 'bg-line-3')} />}
                      <b className="flex-1 truncate font-semibold">{g.name}</b>
                      <span className="font-mono text-[12px] text-fg-3">{g.pipelines}</span>
                    </div>
                    <div className="mt-3 flex gap-1">
                      {ps.map((p) => {
                        const lr = lastByPipeline.get(p.id);
                        const s = lr ? runState(lr) : null;
                        return <span key={p.id} title={`${p.appName}: ${s ?? 'never run'}`} className={cx('h-1.5 flex-1 rounded-full', s === 'failed' ? 'bg-fail' : s === 'approval' ? 'bg-warn' : s === 'running' || s === 'starting' ? 'bg-run' : s === 'success' ? 'bg-primary' : 'bg-surface-3')} />;
                      })}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}
