/**
 * Turns a child's output chunks into whole lines.
 *
 * A pipe delivers bytes in whatever pieces the OS chose: half a line, or forty
 * lines at once. Logging chunks meant one "line" in the UI could be a fragment
 * and a marker like `::ezp step` could be split across two of them. A carriage
 * return without a newline is a progress bar redrawing itself, so only the last
 * frame is kept. A partial line with no newline for half a second (a prompt) is
 * flushed as it is, rather than held until the process exits.
 */
export class LineSplitter {
  private buf = "";
  private timer: NodeJS.Timeout | null = null;
  constructor(private emit: (line: string) => void, private idleMs = 500) {}
  push(chunk: string) {
    this.buf += chunk;
    const parts = this.buf.split("\n");
    this.buf = parts.pop() ?? "";
    for (const p of parts) this.emit(LineSplitter.lastFrame(p));
    if (this.timer) clearTimeout(this.timer);
    this.timer = this.buf ? setTimeout(() => this.flush(), this.idleMs) : null;
    this.timer?.unref?.();
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.buf) this.emit(LineSplitter.lastFrame(this.buf));
    this.buf = "";
  }
  static lastFrame(line: string): string {
    const l = line.endsWith("\r") ? line.slice(0, -1) : line;
    const i = l.lastIndexOf("\r");
    return i === -1 ? l : l.slice(i + 1);
  }
}
