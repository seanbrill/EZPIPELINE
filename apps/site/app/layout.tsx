import type { Metadata, Viewport } from "next";
import "./site.css";
import "./site-shell.css";
import { Footer, Header } from "../components/Chrome";
import { GITHUB, SITE_NAME, SITE_URL, TAGLINE } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "EZPipeline: CI/CD you run yourself", template: `%s | ${SITE_NAME}` },
  description: TAGLINE,
  applicationName: SITE_NAME,
  authors: [{ name: "EZPipeline contributors", url: GITHUB }],
  alternates: { canonical: "/" },
  icons: { icon: "/icon.svg" },
  openGraph: { type: "website", siteName: SITE_NAME, title: "EZPipeline: CI/CD you run yourself", description: TAGLINE, url: "/" },
  twitter: { card: "summary", title: "EZPipeline: CI/CD you run yourself", description: TAGLINE },
};

export const viewport: Viewport = { themeColor: "#09090b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
