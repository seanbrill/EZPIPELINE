import type { Metadata } from "next";
import { DocPage } from "../../components/DocPage";
import { allDocs } from "../../lib/docs";

const overview = () => allDocs().find((d) => d.slug === "")!;

export function generateMetadata(): Metadata {
  return { title: "Docs", description: overview().lead || "EZPipeline's documentation.", alternates: { canonical: "/docs/" } };
}

export default function Docs() {
  return <DocPage doc={overview()} />;
}
