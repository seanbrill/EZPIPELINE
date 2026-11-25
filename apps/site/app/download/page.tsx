import type { Metadata } from "next";
import { DownloadPage } from "../../components/DownloadPage";

export const metadata: Metadata = {
  title: "Download",
  description: "The EZPipeline desktop app for macOS, Windows and Linux, every file with its SHA-256, and how to run the server with Docker or from source.",
  alternates: { canonical: "/download/" },
};

export default function Download() {
  return <DownloadPage />;
}
