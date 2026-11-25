/**
 * Settings › Self-hosting: the deploys made with the wizard, each with what its
 * last run did, and the way into the wizard.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cloud, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { ago } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { PageHead } from '../../components/settings/kit';
import { Button } from '../../components/ui/Button';
import { Banner, Card, EmptyState, Skeleton } from '../../components/ui/Feedback';

interface Deploy {
  id: string; step: number; updatedAt: string;
  config: { name: string; region: string; address: 'lb' | 'domain'; domain: string; size: string };
  deploy: null | { finished: { at: string } | null; lbDns: string | null; moved: unknown };
  run: null | { id: string; number: number; status: string; steps: { name: string; status: string }[] };
}

const TONE: Record<string, string> = { success: 'text-primary-hi', running: 'text-info', failed: 'text-fail', aborted: 'text-fg-3' };

export default function SelfHosting() {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [list, setList] = useState<Deploy[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    api<{ deploys: Deploy[] }>('/selfhost').then((r) => setList(r.deploys)).catch((e) => setErr((e as Error).message));
  }, [isAdmin]);

  const head = <PageHead title="Self-hosting" lede="Run EZPipeline in your own AWS account: one container and one volume, made and kept up to date by a pipeline on this instance." action={isAdmin ? <Button variant="primary" icon={<Cloud className="size-4" />} onClick={() => nav('/selfhost')}>Deploy to a cloud</Button> : undefined} />;
  if (!isAdmin) return <>{head}<Banner>Only an admin can deploy this instance to a cloud.</Banner></>;
  if (err) return <>{head}<Banner tone="fail">{err}</Banner></>;
  if (!list) return <>{head}<Skeleton className="h-24 w-full" /></>;
  if (!list.length) return <>{head}<EmptyState icon={<Cloud />} title="Nothing deployed yet" action={<Button variant="primary" onClick={() => nav('/selfhost')}>Start the wizard</Button>}>Seven steps, about 15 minutes. Nothing is made in your cloud until you press Deploy, and the answers are kept as a draft until then.</EmptyState></>;

  return (
    <>
      {head}
      <div className="flex flex-col gap-3">
        {list.map((d) => {
          const address = d.config.address === 'domain' ? `https://${d.config.domain}` : d.deploy?.lbDns;
          const status = !d.deploy ? 'draft' : d.run?.status ?? 'not started';
          const failed = d.run?.steps.find((s) => s.status === 'failed');
          return (
            <Card key={d.id}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-10 place-items-center rounded-box border border-line-2 font-mono text-[11px] font-semibold text-warn">AWS</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-medium">{d.config.name} <span className="font-mono text-[12px] text-fg-3">{d.config.region}</span></div>
                  <div className="truncate text-[12.5px] text-fg-3">
                    <span className={TONE[status]}>{status === 'draft' ? `Draft, at step ${d.step} of 7` : failed ? `Stopped at ${failed.name}` : status === 'success' ? 'Deployed' : status.charAt(0).toUpperCase() + status.slice(1)}</span>
                    {address && <> · <span className="font-mono">{address}</span></>} · changed {ago(d.updatedAt)}
                  </div>
                </div>
                {address && d.run?.status === 'success' && <a href={address} target="_blank" rel="noreferrer"><Button size="sm" iconRight={<ExternalLink className="size-3.5" />}>Open it</Button></a>}
                {d.run && <Link className="hidden sm:block" to={`/runs/${d.run.id}`}><Button size="sm" variant="ghost">Run #{d.run.number}</Button></Link>}
                <Button size="sm" onClick={() => nav(`/selfhost/${d.id}`)}>{d.deploy ? 'Manage' : 'Continue'}</Button>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-[12.5px] text-fg-3">The deploy and its removal are pipelines in the Self-hosting group. Their Terraform and its state are in this instance's data directory, under selfhost/.</p>
    </>
  );
}
