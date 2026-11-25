/** The instance's name and default theme, readable before anyone signs in. */
import { useEffect, useState } from 'react';
import { api } from './api';

export const VERSION = '2.0.0';

export function useInstance() {
  const [inst, setInst] = useState<{ name: string; theme: string } | null>(null);
  useEffect(() => {
    api<{ name: string; theme: string }>('/instance', { token: '' }).then((i) => {
      setInst(i);
      if (i.name) document.title = i.name;
      // The instance's theme until someone picks their own.
      try { if (!localStorage.getItem('theme')) document.documentElement.setAttribute('data-theme', i.theme); } catch { /* storage blocked */ }
    }).catch(() => setInst({ name: 'EZPipeline', theme: 'classic' }));
  }, []);
  return inst;
}
