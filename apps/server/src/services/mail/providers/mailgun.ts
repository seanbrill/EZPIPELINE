// Mailgun, over its HTTP API.
//
// Form-encoded rather than JSON, and the REGION matters: an EU account rejects
// the US endpoint with a 401 that reads exactly like a wrong key, which is the
// single most common way a Mailgun setup wastes an afternoon.

import type { MailProvider } from "../types.js";
import { httpFailure, missing, present } from "../types.js";

export const mailgunProvider: MailProvider = {
  id: "mailgun",
  label: "Mailgun",
  blurb: "Long-established, strong deliverability reporting. Pick the right region or the key looks wrong.",
  fields: [
    { key: "apiKey", label: "API key", type: "secret", required: true,
      hint: "Mailgun > API Keys. The private key, not the public validation key." },
    { key: "domain", label: "Sending domain", type: "text", placeholder: "mg.example.com", required: true },
    { key: "region", label: "EU region", type: "boolean", required: false,
      hint: "On if your Mailgun account is EU. Wrong region answers 401, which looks like a bad key." },
    { key: "from", label: "From", type: "text", placeholder: "EZPipeline <noreply@mg.example.com>", required: true },
  ],

  async send(config, msg) {
    const apiKey = present(config, "apiKey");
    const domain = present(config, "domain");
    const from = present(config, "from");
    const gaps = [!apiKey ? "apiKey" : "", !domain ? "domain" : "", !from ? "from" : ""].filter(Boolean);
    if (gaps.length) return missing("Mailgun", gaps);

    const base = present(config, "region") === "true" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
    const form = new URLSearchParams({ from: from!, to: msg.to, subject: msg.subject, text: msg.text });
    if (msg.html) form.set("html", msg.html);

    try {
      const res = await fetch(`${base}/v3/${encodeURIComponent(domain!)}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok ? { ok: true } : await httpFailure("Mailgun", res);
    } catch (e) {
      return { ok: false, error: `Mailgun unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
