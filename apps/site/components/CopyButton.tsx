"use client";
import { useState } from "react";
import { Check, Copy } from "./icons";

/** The copy icon beside a command. */
export function CopyButton({ text, className = "cpb" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className} aria-label={done ? "Copied" : "Copy"} onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
    }}>{done ? <Check size="sm" /> : <Copy size="sm" />}</button>
  );
}
