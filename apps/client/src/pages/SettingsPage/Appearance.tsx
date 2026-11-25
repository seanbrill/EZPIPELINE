/** Settings › Appearance (design sheet f22). Applies as you click; kept in this browser. */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { LOG_SIZES, readPrefs, savePref } from '../../lib/prefs';
import { Blk, PageHead } from '../../components/settings/kit';
import { Segmented } from '../../components/ui/Tabs';
import { Switch } from '../../components/ui/Toggle';
import { cx } from '../../components/ui/cx';

const THEMES = [
  { id: 'classic', label: 'Classic', bg: '#0f1720', side: '#0b1118', card: '#16212c', accent: '#34d399' },
  { id: 'midnight', label: 'Midnight', bg: '#05070b', side: '#020305', card: '#0d1118', accent: '#34d399' },
  { id: 'light', label: 'Light', bg: '#f6f7f9', side: '#eceef2', card: '#ffffff', accent: '#059669' },
] as const;

export default function Appearance() {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState(readPrefs);

  return (
    <>
      <PageHead title="Appearance" lede="Just for you, in this browser. Changes apply as you click." />

      <Blk title="Theme" desc="An admin sets the default for people who haven’t picked one.">
        <div role="radiogroup" aria-label="Theme" className="grid max-w-[600px] grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const on = theme === t.id;
            return (
              <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => setTheme(t.id)}
                className={cx('overflow-hidden rounded-card border text-left transition-colors', on ? 'border-primary shadow-[0_0_0_1px_var(--primary)]' : 'border-line-2 hover:border-line-3')}>
                <div aria-hidden className="flex h-[72px] gap-1.5 p-2" style={{ background: t.bg }}>
                  <div className="w-1/4 rounded-[3px]" style={{ background: t.side }} />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-2.5 w-2/3 rounded-full" style={{ background: t.card }} />
                    <div className="flex-1 rounded-[3px]" style={{ background: t.card }}><div className="m-1.5 h-1.5 w-1/3 rounded-full" style={{ background: t.accent }} /></div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 text-[13.5px] font-medium">{t.label}{on && <Check className="ml-auto size-4 text-primary" />}</div>
              </button>
            );
          })}
        </div>
      </Blk>

      <Blk title="Motion" desc="Started from your system setting.">
        <Switch checked={prefs.motion === 'reduce'} onChange={(on) => { savePref('motion', on ? 'reduce' : 'system'); setPrefs(readPrefs()); }}
          label="Reduce motion" description="Stops the pulsing running dot, smooth scrolling and page transitions." />
      </Blk>

      <Blk title="Log text size" desc="For run logs.">
        <div className="flex flex-col gap-3">
          <Segmented label="Log text size" items={LOG_SIZES.map((n) => ({ id: String(n), label: String(n) }))} value={String(prefs.logSize)}
            onChange={(v) => { savePref('logSize', v); setPrefs(readPrefs()); }} />
          <pre className="max-w-[600px] overflow-hidden rounded-box bg-log-bg px-4 py-3 font-mono leading-[1.6] text-log-fg" style={{ fontSize: prefs.logSize }}>
            <span className="text-fg-3">1  </span>Step: Install{'\n'}<span className="text-fg-3">2  </span>added 214 packages in 6s{'\n'}<span className="text-fg-3">3  </span><span className="text-primary-hi">✓ Install · 6.2s</span>
          </pre>
        </div>
      </Blk>
    </>
  );
}
