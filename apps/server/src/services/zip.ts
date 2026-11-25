/**
 * A small zip writer and reader for .ezp bundles, on Node's own zlib, so a
 * bundle needs no third-party archive code. DEFLATE or stored entries, UTF-8
 * names, no zip64 (a bundle is capped well under 4 GB).
 *
 * READING IS THE DANGEROUS HALF. A bundle comes from another machine, so
 * every name is checked before it is used as a path (no "..", no absolute
 * paths, no backslashes, no drive letters), and sizes are capped before and
 * during inflation so a small file cannot expand to fill the disk.
 */
import zlib from "zlib";

export interface ZipEntry { name: string; data: Buffer }

const MAX_ENTRIES = 50_000;
const MAX_ENTRY = 1024 ** 3; // 1 GB
const MAX_TOTAL = 2 * 1024 ** 3; // 2 GB

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** A safe relative name: segments of something, joined by "/". */
export function safeEntryName(name: string): boolean {
  if (!name || name.length > 1024 || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  return name.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export function writeZip(entries: ZipEntry[], when = new Date()): Buffer {
  if (entries.length > MAX_ENTRIES) throw new Error(`A bundle holds at most ${MAX_ENTRIES} files.`);
  const { time, date } = dosTime(when);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    if (!safeEntryName(e.name)) throw new Error(`Not a safe name in a bundle: ${e.name}`);
    const name = Buffer.from(e.name, "utf8");
    const crc = zlib.crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 6 });
    const stored = deflated.length >= e.data.length;
    const body = stored ? e.data : deflated;
    if (offset + body.length > 0xffffffff - 1024) throw new Error("The bundle would be over 4 GB. Export a smaller scope.");

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(stored ? 0 : 8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(stored ? 0 : 8, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);

    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function readZip(buf: Buffer): Map<string, Buffer> {
  const bad = (why: string) => Object.assign(new Error(`This is not a bundle EZPipeline can read: ${why}.`), { status: 400 });
  // The end record is in the last 64 KB (its comment can be up to 65535 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad("it is not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw bad("too many files");
  if (cdOff + cdSize > buf.length) throw bad("it is cut short");

  const out = new Map<string, Buffer>();
  let p = cdOff;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad("its index is damaged");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;

    if (name.endsWith("/")) continue; // a folder
    if (flags & 0x1) throw bad("it is password-protected as a zip");
    if (!safeEntryName(name)) throw bad(`it has an unsafe file name (${name.slice(0, 80)})`);
    if (out.has(name)) throw bad(`it has ${name} twice`);
    if (usize > MAX_ENTRY) throw bad(`${name} is over 1 GB`);
    total += usize;
    if (total > MAX_TOTAL) throw bad("it would unpack to over 2 GB");

    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw bad("a file header is damaged");
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw bad("it is cut short");
    const body = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(usize, 1) }); }
      catch { throw bad(`${name} does not unpack`); }
    } else throw bad(`${name} uses a compression EZPipeline does not read`);
    if (data.length !== usize || zlib.crc32(data) !== crc) throw bad(`${name} is damaged`);
    out.set(name, data);
  }
  return out;
}
