import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "../../../components/DocPage";
import { allDocs } from "../../../lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().filter((d) => d.slug).map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = allDocs().find((x) => x.slug === slug);
  return { title: d?.title ?? "Docs", description: d?.lead || "EZPipeline's documentation.", alternates: { canonical: `/docs/${slug}/` } };
}

export default async function Doc({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = allDocs().find((d) => d.slug === slug);
  if (!doc) notFound();
  return <DocPage doc={doc} />;
}
