"use client";
// The releases and the one file to offer this visitor (from knitted's DownloadButton and
// Releases). The page is built with the list as it was (content/releases.json); the release
// folder as it is now replaces it once FileFreak answers (lib/live-releases.ts).

import { useEffect, useMemo, useState } from "react";
import { detect, diskImages, offer, type Offer, type Release, type Signals } from "../lib/downloads";
import { liveReleases } from "../lib/live-releases";

interface UAData { platform: string; mobile: boolean; getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }> }

async function signals(): Promise<Signals> {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  const high = await data?.getHighEntropyValues(["architecture"]).catch(() => undefined);
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, platform: data?.platform, mobile: data?.mobile, architecture: high?.architecture };
}

/** The graphics chip's name, which WebGL shows where nothing else says which Mac this is. */
function gpu(): string | undefined {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return undefined;
    let name = String(gl.getParameter(gl.RENDERER));
    const info = /WebKit|Mozilla/.test(name) ? gl.getExtension("WEBGL_debug_renderer_info") : null;
    if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return undefined;
  }
}

// One read per visit, shared by every button and list on the page.
let reading: Promise<Release[] | null> | null = null;

export function useReleases(built: Release[]): Release[] {
  const [list, setList] = useState(built);
  useEffect(() => {
    let live = true;
    reading ??= liveReleases((url, init) => fetch(url, init), built).catch(() => null);
    void reading.then((now) => { if (live && now && JSON.stringify(now) !== JSON.stringify(built)) setList(now); });
    return () => { live = false; };
  }, [built]);
  return list;
}

export interface Visitor { offer: Offer | null; label: string | null }

/** What this computer is, said plainly ("a Mac with Apple silicon"), and the file for it. */
export function useOffer(releases: Release[]): Visitor {
  const files = releases[0]?.files;
  const dmgs = useMemo(() => diskImages(releases), [releases]);
  const [v, setV] = useState<Visitor>({ offer: null, label: null });
  useEffect(() => {
    if (!files) return;
    let live = true;
    void signals().then((s) => {
      let m = detect(s);
      if (m.system === "macOS" && m.guessed) m = detect({ ...s, gpu: gpu() });
      const label = m.system === "macOS" ? (m.guessed ? "a Mac" : m.arch === "arm64" ? "a Mac with Apple silicon" : "an Intel Mac")
        : m.system === "Windows" ? "a Windows PC" : m.system === "Linux" ? `Linux on ${m.arch === "arm64" ? "ARM64" : "x86_64"}` : m.system === "mobile" ? "a phone or tablet" : null;
      if (live) setV({ offer: offer(files, m, dmgs), label });
    });
    return () => { live = false; };
  }, [files, dmgs]);
  return v;
}

/** "macOS" from "macOS (Apple silicon)". */
export const systemName = (platform: string) => platform.replace(/ \(.*\)$/, "");
/** "Apple silicon" from "macOS (Apple silicon)". */
export const chipName = (platform: string) => /\((.*)\)$/.exec(platform)?.[1] ?? null;
