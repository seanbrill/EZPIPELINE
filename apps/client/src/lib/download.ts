import API_URL from '../config/api';

/** Download an export with the session's token, as a file the browser saves. */
export async function downloadExport(file: string) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}/api/exports/${encodeURIComponent(file)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The server answered ${res.status}.`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: file });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Send a .ezp file to be read. Returns what is in it. */
export async function uploadBundle<T>(file: File): Promise<T> {
  const token = localStorage.getItem('token');
  const form = new FormData();
  form.append('bundle', file, file.name);
  const res = await fetch(`${API_URL}/api/import/inspect`, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
  return data as T;
}
