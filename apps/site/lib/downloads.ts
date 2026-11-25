// The one download to offer a visitor: their system and chip, as the browser tells them,
// matched against a release's files. No browser in here, so test/downloads.test.mjs can
// check every case. components/DownloadButton.tsx reads the browser and calls it.

export type System = "macOS" | "Windows" | "Linux";
export type Arch = "arm64" | "x64";
/** One installer, as scripts/releases-lib.mjs writes it into content/releases.json. arch null: every chip. */
export interface Download { platform: string; system: System; arch: Arch | null; name: string; url: string; size: string; sha256: string }
/** One version and its installers. content/releases.json lists them newest first. */
/** sums: the link to the version's SHA256SUMS.txt, when the folder has one. */
export interface Release { version: string; files: Download[]; sums?: string }

/** What the browser says about the computer. Any of it may be missing. */
export interface Signals {
  userAgent: string;
  maxTouchPoints?: number;
  /** From navigator.userAgentData, which only Chromium browsers have. */
  platform?: string;
  mobile?: boolean;
  /** From userAgentData.getHighEntropyValues: "arm" or "x86". */
  architecture?: string;
  /** The graphics chip's name, from WebGL. */
  gpu?: string;
}

/** "mobile" is a phone or a tablet, where nothing here installs. guessed: the chip is a guess. */
export interface Machine { system: System | "mobile" | null; arch: Arch | null; guessed: boolean }

// When nothing says which chip: most Macs sold since 2021 are Apple silicon, and nearly
// every Windows and Linux PC is x64.
const GUESS: Record<System, Arch> = { macOS: "arm64", Windows: "x64", Linux: "x64" };

const systemOf = (s: Signals): System | null => {
  if (s.platform) return s.platform === "macOS" || s.platform === "Windows" || s.platform === "Linux" ? s.platform : null;
  const ua = s.userAgent;
  return /Macintosh|Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? null : /Linux|X11/.test(ua) ? "Linux" : null;
};

// Chromium browsers say the chip outright. Elsewhere a Linux browser's user agent still names
// it, and a Mac's graphics chip gives it away: Apple silicon's is Apple's, an Intel Mac's is
// Intel's, AMD's or NVIDIA's. Safari calls every one "Apple GPU", which proves nothing.
const archOf = (system: System, s: Signals): Arch | null => {
  if (s.architecture === "arm") return "arm64";
  if (s.architecture === "x86") return "x64";
  if (system === "Linux") return /aarch64|arm64/i.test(s.userAgent) ? "arm64" : /x86_64|amd64/i.test(s.userAgent) ? "x64" : null;
  if (system === "macOS" && s.gpu) return /Apple M\d/i.test(s.gpu) ? "arm64" : /Intel|AMD|Radeon|NVIDIA|GeForce/i.test(s.gpu) ? "x64" : null;
  return null;
};

export function detect(s: Signals): Machine {
  // An iPad asks for desktop pages and says it is a Mac. Its touch screen gives it away.
  const touchMac = /Macintosh/.test(s.userAgent) && (s.maxTouchPoints ?? 0) > 1;
  if (s.mobile || s.platform === "Android" || s.platform === "iOS" || /Android|iPhone|iPad|iPod/.test(s.userAgent) || touchMac) return { system: "mobile", arch: null, guessed: false };
  const system = systemOf(s);
  if (!system) return { system: null, arch: null, guessed: false };
  const arch = archOf(system, s);
  return arch ? { system, arch, guessed: false } : { system, arch: GUESS[system], guessed: true };
}

// The chip each one also runs, emulated: Apple silicon and Windows on Arm run x64 apps.
const ALSO_RUNS: Record<System, Partial<Record<Arch, Arch>>> = { macOS: { arm64: "x64" }, Windows: { arm64: "x64" }, Linux: {} };
// The file to offer on each system, best first: the one people open by double-clicking.
const FORMATS: Record<System, string[]> = { macOS: [".dmg", ".zip"], Windows: [".exe", ".msi", ".zip"], Linux: [".appimage", ".deb", ".rpm"] };

/** The best file for this system and chip, or null when none of them runs there. */
export function pick(files: Download[], system: System, arch: Arch): Download | null {
  // A build for its own chip, or for every chip, runs natively. After those, one it runs emulated.
  const rank = (f: Download) => (f.arch === arch || f.arch === null ? 0 : f.arch === ALSO_RUNS[system][arch] ? 1 : -1);
  const format = (f: Download) => FORMATS[system].findIndex((ext) => f.name.toLowerCase().endsWith(ext));
  const fits = files.filter((f) => f.system === system && rank(f) >= 0 && format(f) >= 0);
  return fits.sort((a, b) => rank(a) - rank(b) || format(a) - format(b))[0] ?? null;
}

const isDiskImage = (f: Download) => f.system === "macOS" && f.name.toLowerCase().endsWith(".dmg");

/**
 * The Mac disk images to show beside the newest release when it has none of its own. A
 * version the pipeline publishes has the Mac app as a .zip only, because only a Mac makes a
 * .dmg, so the newest .dmg can be a version or more behind. Installed, it updates itself.
 */
export function diskImages(releases: Release[]): Release | null {
  if (!releases.length || releases[0].files.some(isDiskImage)) return null;
  for (const r of releases.slice(1)) {
    const files = r.files.filter(isDiskImage);
    if (files.length) return { version: r.version, files };
  }
  return null;
}

export type Offer =
  /**
   * intel: the Intel Mac build as well, when the Mac's chip is only a guess. diskImage: an
   * older version's .dmg for this Mac, when the file is a .zip because the newest has none.
   */
  | { kind: "file"; file: Download; intel: Download | null; diskImage: { version: string; file: Download } | null }
  | { kind: "mobile" }
  /** unknown: which computer this is. none: nothing in the release runs on it. */
  | { kind: "unknown" }
  | { kind: "none" };

/** older: what diskImages() found for the newest release, if anything. */
export function offer(files: Download[], m: Machine, older: Release | null = null): Offer {
  if (m.system === "mobile") return { kind: "mobile" };
  if (!m.system || !m.arch) return { kind: "unknown" };
  const file = pick(files, m.system, m.arch);
  if (!file) return { kind: "none" };
  const intel = m.system === "macOS" && m.guessed ? pick(files, "macOS", "x64") : null;
  const dmg = older && m.system === "macOS" && file.name.toLowerCase().endsWith(".zip") ? pick(older.files, "macOS", m.arch) : null;
  return { kind: "file", file, intel: intel && intel.name !== file.name ? intel : null, diskImage: older && dmg ? { version: older.version, file: dmg } : null };
}
