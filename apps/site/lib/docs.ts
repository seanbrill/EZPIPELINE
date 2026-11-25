// The docs pages (design f155) are the repository's docs/*.md, read and rendered at build
// time, so the site and GitHub show the same words. README.md is the overview at /docs/.
//
//   title    the file's first "# " heading
//   lead     the first paragraph under it (shown under the title, not again in the body)
//   links    to another doc become its page; to anything else in the repository, GitHub

import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";
import { GITHUB } from "./site";

export interface Doc {
  slug: string;          // "" for the overview
  file: string;          // "pipeline-schema.md"
  title: string;
  lead: string;          // plain text
  group: string;
  body: string;          // markdown after the title and lead
}
export interface Heading { depth: 2 | 3; id: string; text: string }

/** The sidebar (f155): four groups, in reading order. A doc not named here goes last. */
export const GROUPS: { name: string; files: string[] }[] = [
  { name: "Start here", files: ["README.md", "setup.md", "configuration.md", "deployment.md", "self-hosting.md", "kubernetes.md"] },
  { name: "Pipelines", files: ["pipeline-guide.md", "pipeline-schema.md", "scripts.md"] },
  { name: "Running it", files: ["permissions.md", "authentication.md", "ai-assistant.md", "troubleshooting.md"] },
  { name: "Reference", files: ["api-reference.md", "architecture.md", "development.md", "RELEASING.md"] },
];

function docsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, "docs");
    if (fs.existsSync(path.join(p, "pipeline-schema.md"))) return p;
    dir = path.dirname(dir);
  }
  throw new Error("docs/ not found above " + process.cwd());
}

const plain = (md: string) => md.replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

function parse(file: string, raw: string): Doc {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const h = lines.findIndex((l) => l.startsWith("# "));
  const title = h >= 0 ? lines[h].slice(2).trim() : file;
  let i = h + 1;
  while (i < lines.length && !lines[i].trim()) i++;
  const start = i;
  while (i < lines.length && lines[i].trim() && !/^(#|```|\||[-*] |\d+\. |---)/.test(lines[i])) i++;
  const lead = i > start ? plain(lines.slice(start, i).join(" ")) : "";
  const body = lines.slice(i > start ? i : h + 1).join("\n").replace(/^\s*---\s*\n/, "");
  const slug = file === "README.md" ? "" : file.replace(/\.md$/, "").toLowerCase();
  const group = GROUPS.find((g) => g.files.includes(file))?.name ?? "More";
  return { slug, file, title: file === "README.md" ? "Overview" : title, lead, group, body };
}

let cache: Doc[] | null = null;
export function allDocs(): Doc[] {
  if (cache) return cache;
  const dir = docsDir();
  const order = GROUPS.flatMap((g) => g.files);
  const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : 999);
  cache = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
    .map((f) => parse(f, fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file));
  return cache;
}

export const docPath = (d: Pick<Doc, "slug">) => (d.slug ? `/docs/${d.slug}/` : "/docs/");

/** A heading's anchor, made the way GitHub makes it, so links written against GitHub land here too. */
export function slugify(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&(#\d+|[a-z]+);/g, "").toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

/** A link as written in docs/*.md, as the site serves it. */
export function siteHref(href: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [file, hash] = href.split("#");
  const m = /^(?:\.\/)?([\w-]+)\.md$/.exec(file);
  if (m) return (m[1] === "README" ? "/docs/" : `/docs/${m[1].toLowerCase()}/`) + (hash ? `#${hash}` : "");
  // Anything else is a file in the repository, relative to docs/.
  const repoPath = path.posix.normalize(path.posix.join("docs", file));
  return `${GITHUB}/blob/main/${repoPath}${hash ? `#${hash}` : ""}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page's HTML and its h2/h3 headings, for "On this page". */
export function renderDoc(d: Doc): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        let id = slugify(text) || "section";
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth === 2 || depth === 3) headings.push({ depth, id, text: text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const to = siteHref(href);
        const ext = /^https?:/.test(to) && !to.startsWith("https://ezpipeline.");
        return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
      table(t: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td") => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${t.header.map((c) => cell(c, "th")).join("")}</tr>`;
        const rows = t.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
        return `<div class="tw"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
      },
      // Raw HTML in a doc is shown as text: the docs are markdown, and nothing in them runs.
      html({ text }: Tokens.HTML | Tokens.Tag) { return esc(text); },
    },
  });
  const html = marked.parse(d.body, { async: false }) as string;
  return { html, headings };
}
