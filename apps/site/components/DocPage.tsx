// One docs page (design f155): the title band, the sidebar, the article, "On this page".
import Link from "next/link";
import { allDocs, docPath, renderDoc, type Doc } from "../lib/docs";
import { GITHUB } from "../lib/site";
import { CodeCopy, DocsNav, DocsSelect, Toc, type NavDoc } from "./DocsClient";
import { Pencil } from "./icons";

export function DocPage({ doc }: { doc: Doc }) {
  const docs = allDocs();
  const i = docs.indexOf(doc);
  const { html, headings } = renderDoc(doc);
  const nav: NavDoc[] = docs.map((d) => ({ href: docPath(d), title: d.title, lead: d.lead, group: d.group, on: d === doc }));
  const prev = docs[i - 1], next = docs[i + 1];
  return (
    <div className="p-doc">
      <section className="dk"><div className="hgrid" /><div className="hglow" /><div className="wrap">
        <span className="kick">Docs · {doc.group}</span>
        <h1><span className="gw">{doc.title}</span></h1>
        {doc.lead && <p className="lead">{doc.lead}</p>}
      </div></section>
      <div className="wrap dl">
        <DocsNav docs={nav} />
        <article className="doc">
          <DocsSelect docs={nav} />
          <div id="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
          <CodeCopy target="doc-body" />
          <div className="dedit"><Pencil size="sm" /><a href={`${GITHUB}/edit/main/docs/${doc.file}`}>Edit this page on GitHub</a><span className="src">docs/{doc.file}</span></div>
          <nav className="dpn" aria-label="Previous and next">
            {prev && <Link href={docPath(prev)}><span>Previous</span>{prev.title}</Link>}
            {next && <Link className="n" href={docPath(next)}><span>Next</span>{next.title}</Link>}
          </nav>
        </article>
        <Toc headings={headings} />
      </div>
    </div>
  );
}
