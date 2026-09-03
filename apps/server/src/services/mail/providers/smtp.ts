// Plain SMTP, via nodemailer.
//
// Kept because it is the only option that works with a mail server somebody
// already runs, and because it is what this app used before there was a
// choice. It is NOT the recommended one: an SMTP username and password is a
// long-lived credential with no scope, so a leak is mailbox access rather than
// send-only access. Every API provider here issues a key that can only send.

import nodemailer from "nodemailer";
import type { MailMessage, MailProvider, SendResult } from "../types.js";
import { missing, present } from "../types.js";

export const smtpProvider: MailProvider = {
  id: "smtp",
  label: "SMTP",
  blurb:
    "Any mail server you already have. Works everywhere; the credential is a full mailbox password, so prefer an API provider if you have the choice.",
  fields: [
    { key: "host", label: "Host", type: "text", placeholder: "smtp.example.com", required: true },
    { key: "port", label: "Port", type: "number", placeholder: "587", required: true,
      hint: "587 for STARTTLS, 465 for implicit TLS." },
    { key: "secure", label: "Implicit TLS", type: "boolean", required: false,
      hint: "On for port 465. Off for 587, which upgrades with STARTTLS." },
    { key: "user", label: "Username", type: "text", required: true },
    { key: "pass", label: "Password", type: "secret", required: true,
      hint: "For Gmail this must be an App Password, not the account password." },
    { key: "from", label: "From", type: "text", placeholder: '"EZPipeline" <noreply@example.com>', required: true },
  ],

  async send(config, msg: MailMessage): Promise<SendResult> {
    const host = present(config, "host");
    const from = present(config, "from");
    if (!host || !from) {
      return missing("SMTP", [!host ? "host" : "", !from ? "from" : ""].filter(Boolean));
    }
    const port = Number(present(config, "port") ?? 587);
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: present(config, "secure") === "true",
        auth: present(config, "user")
          ? { user: config.user!, pass: config.pass ?? "" }
          : undefined,
      });
      await transporter.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
      return { ok: true };
    } catch (e) {
      // nodemailer's messages are unusually good, so they are passed through
      // rather than replaced with something vaguer.
      return { ok: false, error: `SMTP failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
