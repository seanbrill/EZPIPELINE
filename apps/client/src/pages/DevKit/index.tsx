/**
 * /dev/kit: every v2 primitive on one page, in whichever theme is picked.
 * Development builds only. It is how a component is checked against its frame
 * on the design sheet without finding a screen that happens to use it.
 */
import { useState } from 'react';
import { ArrowRight, Copy, FolderInput, GitBranch, MoreHorizontal, Play, RotateCcw, Search, Terminal, Trash2 } from 'lucide-react';
import {
  Badge, Banner, Button, Card, Checkbox, EmptyState, ErrorState, Field, IconButton, Input, Kbd, Menu, Modal,
  RadioGroup, Segmented, Select, Skeleton, Switch, Tabs, Textarea,
} from '../../components/ui';
import { Logo, LogoMark } from '../../components/brand/Logo';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import { useTheme } from '../../contexts/ThemeContext';
import { CommitChip } from '../../components/run/CommitChip';
import { CommitCard } from '../../components/run/CommitCard';
import { RunSegments, StepGrid } from '../../components/run/StepGrid';
import type { TileModel } from '../../components/run/StepGrid';
import { RunStatusBadge } from '../../components/run/status';
import type { RunState, StepState } from '../../components/run/status';

const THREE_HOURS_AGO = new Date(Date.now() - 3 * 3600e3).toISOString();

const STEPS: [string, string][] = [
  ['Preflight, tooling', '3.9s'], ['Fetch the application source', '2.7s'], ['Is this pipeline running its own current definition', '<0.1s'],
  ['Preflight, configuration', '0.7s'], ['Typecheck and static checks', '46s'], ['Azure sign-in', '9.9s'], ['Find what provisioning created', '12s'],
  ['Create the application\'s database role', '1.0s'], ['Give the SQL console its login', '0.7s'], ['Put the secrets in the vault', '21s'],
  ['Build and push the images', '2m 05s'], ['Migrate, before anything runs the new code', '—'], ['Plan the rollout', '—'], ['Approve this rollout', '—'],
  ['Remember what is serving now', '—'], ['Roll the apps onto the new images', '—'], ['Does it actually answer', '—'], ['Prune old images', '—'],
  ['Trim the archive', '—'], ['Discard the Azure credential cache', '—'],
];

const TILES: TileModel[] = STEPS.map(([name, time], i) => {
  const state: StepState = i < 10 ? 'done' : i === 10 ? 'running' : 'waiting';
  return {
    key: String(i),
    number: String(i + 1).padStart(2, '0'),
    name,
    time,
    state,
    progress: i === 10 ? 0.55 : null,
    substeps: i === 4 ? ['done', 'done', 'done'] : i === 9 ? ['done', 'done', 'done', 'done'] : i === 10 ? ['done', 'running', 'waiting', 'waiting'] : i === 15 ? ['waiting', 'waiting', 'waiting'] : undefined,
  };
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0 space-y-5">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

export default function DevKit() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const { theme, setTheme } = useTheme();
  const [modal, setModal] = useState<null | 'sm' | 'md' | 'lg'>(null);
  const [busy, setBusy] = useState(false);
  const [sw, setSw] = useState(true);
  const [chk, setChk] = useState(true);
  const [radio, setRadio] = useState<'instance' | 'group' | 'pipeline'>('instance');
  const [tab, setTab] = useState('runs');
  const [seg, setSeg] = useState('all');
  const [sel, setSel] = useState<string | null>(null);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur sm:px-6">
        <Logo />
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3 sm:inline">dev · kit</span>
        <div className="ml-auto">
          <Segmented
            label="Theme"
            value={theme}
            onChange={(t) => setTheme(t as typeof theme)}
            items={[{ id: 'classic', label: 'Classic' }, { id: 'midnight', label: 'Midnight' }, { id: 'light', label: 'Light' }]}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <Section title="Logo">
          <div className="flex flex-wrap items-end gap-6">
            <LogoMark size={96} />
            <LogoMark size={64} state="running" />
            <LogoMark size={64} state="approval" />
            <LogoMark size={64} state="failed" />
            <LogoMark size={40} />
            <Logo size={28} />
            <LogoMark size={16} />
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={<Play className="size-4" />}>Run pipeline</Button>
            <Button icon={<Terminal className="size-4" />}>Open logs</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />}>Delete pipeline</Button>
            <Button variant="danger-solid">Delete for good</Button>
            <Button variant="primary" loading loadingText="Starting…">Run pipeline</Button>
            <Button loading loadingText="Testing key…">Test key</Button>
            <Button variant="primary" disabled>Run pipeline</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm">Small 28</Button>
            <Button variant="primary">Default 36</Button>
            <Button variant="primary" size="lg">Large 44</Button>
            <IconButton label="More" variant="secondary"><MoreHorizontal className="size-4" /></IconButton>
            <IconButton label="Copy commit SHA" shortcut="C"><Copy className="size-4" /></IconButton>
            <Button variant="secondary" className="action-ready text-primary-hi" iconRight={<ArrowRight className="size-4" />}>Promote to production</Button>
          </div>
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Fields">
            <Field label="Pipeline name" hint="Shown on runs and in alerts."><Input placeholder="e.g. FileFreak deploy (prod)" /></Field>
            <Field label="Repository" error="Deploy keys need the SSH form: git@github.com:seanbrill/FileFreak.io.git">
              <Input defaultValue="https://github.com/seanbrill/FileFreak.io" />
            </Field>
            <Field label="Group">
              <Select leading={<FolderInput />} defaultValue="FileFreak">
                <option>4SeasonsWharton</option><option>FileFreak</option><option>Knitted</option>
              </Select>
            </Field>
            <Field label="Search">
              <Input leading={<Search />} placeholder="Pipelines, runs, commits…" trailing={<><Kbd>⌘</Kbd><Kbd>K</Kbd></>} />
            </Field>
            <Field label="Notes"><Textarea placeholder="echo hello" /></Field>
          </Section>

          <Section title="Selection & navigation">
            <Switch checked={sw} onChange={setSw} label="Pipelines in this group read with this key" description="Off for a key that can push." />
            <Checkbox checked={chk} onChange={setChk} label="Include environment variables" />
            <RadioGroup value={radio} onChange={setRadio} options={[{ value: 'instance', label: 'Entire instance' }, { value: 'group', label: 'One group' }, { value: 'pipeline', label: 'One pipeline' }]} />
            <Tabs value={tab} onChange={setTab} items={[{ id: 'runs', label: 'Runs', count: 135 }, { id: 'steps', label: 'Steps' }, { id: 'yaml', label: 'YAML' }, { id: 'env', label: 'Environment' }, { id: 'versions', label: 'Versions', count: 12 }]} />
            <div className="flex flex-wrap gap-3">
              <Segmented value={seg} onChange={setSeg} items={[{ id: 'all', label: 'All' }, { id: 'prod', label: 'prod' }, { id: 'staging', label: 'staging' }, { id: 'dev', label: 'dev' }]} />
              <Menu
                title="FileFreak deploy (prod)"
                trigger={<Button icon={<MoreHorizontal className="size-4" />}>Menu</Button>}
                items={[
                  { heading: 'Run #136' },
                  { label: 'Open logs', icon: <Terminal />, shortcut: 'L', onSelect: () => toast.info('Open logs') },
                  { label: 'Copy commit SHA', icon: <Copy />, shortcut: 'C', onSelect: () => toast.success('Copied 34749b8') },
                  { label: 'Rerun', icon: <RotateCcw />, onSelect: () => toast.running('Run #137 started') },
                  { separator: true },
                  { label: 'Delete run', icon: <Trash2 />, danger: true, onSelect: () => toast.error('Deleted') },
                ]}
              />
            </div>
          </Section>
        </div>

        <Section title="Badges & status">
          <div className="flex flex-wrap items-center gap-2">
            {(['queued', 'starting', 'running', 'approval', 'success', 'warning', 'failed', 'aborted'] as RunState[]).map((s) => <RunStatusBadge key={s} state={s} />)}
            <Badge tone="auto">auto</Badge>
            <Badge env tone="warn">prod</Badge>
            <Badge env tone="run">staging</Badge>
            <Badge env>dev</Badge>
            <CommitChip sha="5ad62f7a1c" branch="main" />
            <CommitChip fallback="manual · main" />
          </div>
          <RunSegments states={['done', 'done', 'done', 'done', 'running', 'waiting', 'waiting', 'approval', 'waiting']} outline={[4, 4]} className="max-w-md" />
        </Section>

        <Section title="Commit card">
          <CommitCard
            commit={{
              sha: '34749b8c2e', branch: 'main', author: 'Sean Brill', date: THREE_HOURS_AGO,
              subject: 'feat(app): SD cards on Android, Check for updates and Update behind app_updates',
              body: 'The Android app can open and save files on an SD card. Check for updates asks the server for the newest build, and Update downloads it and hands it to the installer. Both stay hidden until app_updates is on for the account.',
              files: 18, insertions: 642, deletions: 121, url: 'https://github.com',
            }}
            alsoIn={[{ sha: '513cd30', subject: 'test(e2e): the Notifications test uses the Bell, Email and Text choices' }]}
          />
          <CommitCard resolving commit={{ sha: '137f165', subject: '' }} />
        </Section>

        <Section title="Step grid">
          <StepGrid tiles={TILES} selected={sel} onSelect={setSel} onOpen={(k) => toast.info(`Open substeps of ${STEPS[Number(k)][0]}`)} />
        </Section>

        <Section title="Overlays & feedback">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setModal('sm')}>Modal S</Button>
            <Button onClick={() => setModal('md')}>Modal M</Button>
            <Button onClick={() => setModal('lg')}>Modal L</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await confirm({ title: 'Delete FileFreak deploy (prod)?', message: 'Its 135 runs, logs and 12 versions go with it. Groups and other pipelines are not touched.', confirmText: 'Delete for good', isDangerous: true, requireText: 'FileFreak deploy (prod)' });
                if (ok) toast.error('Deleted FileFreak deploy (prod)');
              }}
            >
              Type-to-confirm
            </Button>
            <Button onClick={() => toast.success('Run #136 succeeded in 9m 12s', { commit: { sha: '34749b8', branch: 'main', subject: 'feat(app): SD cards on Android, Check for updates…' } })}>Toast success</Button>
            <Button onClick={() => toast.warning('Run #8 is waiting for approval', { commit: { sha: 'd2d4fdf', branch: 'main', subject: 'Pipeline: clone the now-private repository over SSH' }, action: { label: 'Review and approve', onClick: () => {} } })}>Toast approval</Button>
            <Button onClick={() => toast.error('FileFreak deploy (prod) failed at Verify', { commit: { sha: '137f165', branch: 'main', subject: 'feat(files): a Type filter in My files…' } })}>Toast failure</Button>
          </div>
          <Banner tone="warn" title="Run #8 needs you" action={<Button size="sm" variant="secondary">Review</Button>}>Promote to production is waiting 6 min.</Banner>
          <Banner tone="fail" title="The server stopped answering">Retrying in 4s. Runs keep going on the server.</Banner>
          <div className="grid gap-4 md:grid-cols-2">
            <Card pad={false}>
              <EmptyState icon={<GitBranch />} title="No pipelines yet" action={<Button variant="primary">New pipeline</Button>}>
                A pipeline is a list of shell steps in YAML. Start from a template or paste your own.
              </EmptyState>
            </Card>
            <Card pad={false}>
              <ErrorState title="You can't edit this pipeline" detail="needs: can edit YAML">Ask an admin for “can edit YAML” on FileFreak.</ErrorState>
            </Card>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" rounded="rounded-box" />
          </div>
        </Section>
      </main>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        size={modal ?? 'md'}
        title="Move FileFreak deploy (prod)"
        description="From its next run it uses the new group's environment variables, resources and credentials."
        icon={<FolderInput />}
        busy={busy}
        onSubmit={() => setModal(null)}
        footerStart={<><Kbd>esc</Kbd> cancel <Kbd>⌘</Kbd><Kbd>↵</Kbd> move</>}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              loadingText="Moving…"
              onClick={() => {
                setBusy(true);
                window.setTimeout(() => {
                  setBusy(false);
                  setModal(null);
                  toast.success('Moved to Knitted');
                }, 1200);
              }}
            >
              Move pipeline
            </Button>
          </>
        }
      >
        <Field label="Move to">
          <Select defaultValue="Knitted"><option>4SeasonsWharton</option><option>Knitted</option><option>Notch.fm</option></Select>
        </Field>
      </Modal>
    </div>
  );
}
