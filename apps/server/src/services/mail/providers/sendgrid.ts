// Twilio SendGrid, over its HTTP API.
//
// No SDK. One POST with a bearer token is the whole integration, and a
// dependency that exists to build one JSON body is a dependency to keep
// patched forever.

import type { MailProvider } from "../types.js";
import { httpFailure, missing, present } from "../types.js";

export const sendgridProvider: MailProvider = {
  id: "sendgrid",
  label: "SendGrid (Twilio)",
  blurb:
    "Twilio's mail service. A send-only API key, a generous free tier, and delivery reporting in their dashboard.",
  fields: [
    { key: "apiKey", label: "API key", type: "secret", required: true,
      hint: "SendGrid > Settings > API Keys. 'Restricted Access' with Mail Send is enough." },
    { key: "from", label: "From address", type: "text", placeholder: "noreply@example.com", required: true,
      hint: "Must be a verified Single Sender or on a verified domain." },
    { key: "fromName", label: "From name", type: "text", placeholder: "EZPipeline", required: false },
  ],

  async send(config, msg) {
    const apiKey = present(config, "apiKey");
    const from = present(config, "from");
    if (!apiKey || !from) {
      return missing("SendGrid", [!apiKey ? "apiKey" : "", !from ? "from" : ""].filter(Boolean));
    }
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: msg.to }] }],
          from: { email: from, ...(present(config, "fromName") ? { name: config.fromName } : {}) },
          subject: msg.subject,
          content: [
            { type: "text/plain", value: msg.text },
            ...(msg.html ? [{ type: "text/html", value: msg.html }] : []),
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      // 202 is success here, not 200.
      return res.ok ? { ok: true } : await httpFailure("SendGrid", res);
    } catch (e) {
      return { ok: false, error: `SendGrid unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
