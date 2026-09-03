// Resend, over its HTTP API. The simplest of the lot to set up.

import type { MailProvider } from "../types.js";
import { httpFailure, missing, present } from "../types.js";

export const resendProvider: MailProvider = {
  id: "resend",
  label: "Resend",
  blurb:
    "The quickest to get working: one key, one verified domain. Good default if you have no mail provider yet.",
  fields: [
    { key: "apiKey", label: "API key", type: "secret", required: true,
      hint: "Resend > API Keys. Starts with re_." },
    { key: "from", label: "From", type: "text", placeholder: "EZPipeline <noreply@example.com>", required: true,
      hint: "The domain has to be verified in Resend, or sending is refused." },
  ],

  async send(config, msg) {
    const apiKey = present(config, "apiKey");
    const from = present(config, "from");
    if (!apiKey || !from) {
      return missing("Resend", [!apiKey ? "apiKey" : "", !from ? "from" : ""].filter(Boolean));
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          ...(msg.html ? { html: msg.html } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok ? { ok: true } : await httpFailure("Resend", res);
    } catch (e) {
      return { ok: false, error: `Resend unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
