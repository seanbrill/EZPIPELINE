// Postmark, over its HTTP API.
//
// Worth having in the list because it separates transactional from bulk mail
// at the account level, which is exactly what a verification code is.

import type { MailProvider } from "../types.js";
import { httpFailure, missing, present } from "../types.js";

export const postmarkProvider: MailProvider = {
  id: "postmark",
  label: "Postmark",
  blurb: "Built for transactional mail specifically. The best choice if a verification code arriving fast matters.",
  fields: [
    { key: "serverToken", label: "Server API token", type: "secret", required: true,
      hint: "Postmark > Servers > your server > API Tokens." },
    { key: "from", label: "From", type: "text", placeholder: "noreply@example.com", required: true,
      hint: "Must be a confirmed Sender Signature or on a verified domain." },
  ],

  async send(config, msg) {
    const token = present(config, "serverToken");
    const from = present(config, "from");
    if (!token || !from) {
      return missing("Postmark", [!token ? "serverToken" : "", !from ? "from" : ""].filter(Boolean));
    }
    try {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": token,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          From: from,
          To: msg.to,
          Subject: msg.subject,
          TextBody: msg.text,
          ...(msg.html ? { HtmlBody: msg.html } : {}),
          // Codes and notices are transactional; saying so keeps them out of
          // the bulk stream and its slower queue.
          MessageStream: "outbound",
        }),
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok ? { ok: true } : await httpFailure("Postmark", res);
    } catch (e) {
      return { ok: false, error: `Postmark unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
