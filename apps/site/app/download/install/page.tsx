import type { Metadata } from "next";
import { InstallPage } from "../../../components/InstallPage";

export const metadata: Metadata = {
  title: "Install",
  description: "How to open the EZPipeline desktop app on macOS, Windows and Linux, and check the file is the real one.",
  alternates: { canonical: "/download/install/" },
};

export default function Install() {
  return <InstallPage />;
}
