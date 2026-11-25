import { LandingSections } from "../components/gen/LandingSections";
import { GITHUB, SITE_URL, TAGLINE } from "../lib/site";

const ld = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "EZPipeline",
  url: SITE_URL,
  description: TAGLINE,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Windows, Linux",
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  codeRepository: GITHUB,
};

export default function Home() {
  return (
    <div className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <LandingSections />
    </div>
  );
}
