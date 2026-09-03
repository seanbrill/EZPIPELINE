// Mail, with a choice of provider.
//
// WHAT CHANGED AND WHY. This app could only send over SMTP, which in practice
// meant an operator's own Gmail App Password: a long-lived credential with no
// scope, giving whoever holds it access to a mailbox rather than permission to
// send. It was also stored in the `settings` table in plain text, and the GET
// route handed it back unmasked.
//
// Now there are six providers, five of which issue a send-only key, and every
// credential is encrypted at rest and never returned to the browser.
//
// THE PROVIDERS ARE DATA, NOT BRANCHES. Each one declares its own fields and
// the Settings form is generated from them, so a provider cannot ship with a
// form that disagrees with what the server reads - which is precisely how the
// SMTP form and the SMTP route drifted apart.

import Logger from "../../controllers/Logger.js";
import { SettingsService } from "../SettingsService.js";
import { EMAIL_CONFIG } from "../../config/index.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import type { MailMessage, MailProvider, ProviderField, SendResult } from "./types.js";
import { smtpProvider } from "./providers/smtp.js";
import { sendgridProvider } from "./providers/sendgrid.js";
import { resendProvider } from "./providers/resend.js";
import { mailgunProvider } from "./providers/mailgun.js";
import { postmarkProvider } from "./providers/postmark.js";
import { acsProvider } from "./providers/acs.js";

/**
 * Ordered as the picker shows them: the easiest to get working first, SMTP
 * last because it is the fallback rather than the recommendation.
 */
export const PROVIDERS: readonly MailProvider[] = [
  resendProvider,
  sendgridProvider,
  postmarkProvider,
  acsProvider,
  mailgunProvider,
  smtpProvider,
];

export const DEFAULT_PROVIDER = "smtp";

export function providerById(id: string): MailProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** `mail_<provider>_<field>`, namespaced so two providers cannot collide. */
function settingKey(providerId: string, field: string): string {
  return `mail_${providerId}_${field}`;
}

/**
 * The SMTP keys this app used before providers existed.
 *
 * Read as a fallback so an upgrade does not silently stop sending mail. An
 * operator who never opens Settings keeps working, and the first save migrates
 * them to the namespaced keys.
 */
const LEGACY_SMTP: Record<string, string> = {
  host: "smtp_host",
  port: "smtp_port",
  secure: "smtp_secure",
  user: "smtp_user",
  pass: "smtp_pass",
  from: "smtp_from",
};

export class MailService {
  private static instance: MailService;
  private constructor() {}

  public static getInstance(): MailService {
    MailService.instance ??= new MailService();
    return MailService.instance;
  }

  /** Which provider is selected. */
  public selectedProviderId(): string {
    const stored = (SettingsService.getInstance().get("mail_provider") ?? "").trim();
    return providerById(stored) ? stored : DEFAULT_PROVIDER;
  }

  /**
   * Every field's value for a provider, secrets decrypted, ready to send with.
   *
   * The environment is consulted only for SMTP, and only as a last resort: it
   * is how this app was configured before, and dropping it would break a
   * working install on upgrade.
   */
  public resolveConfig(provider: MailProvider): Record<string, string> {
    const settings = SettingsService.getInstance();
    const out: Record<string, string> = {};

    for (const field of provider.fields) {
      // Provenance is tracked, because it changes what a stored secret MEANS.
      // One that came from the settings table should be encrypted at rest; one
      // that came from the environment is already outside the database, and
      // telling an operator to "re-save it in Settings" would move it IN.
      let raw = settings.get(settingKey(provider.id, field.key)) ?? "";
      let fromDatabase = raw !== "";

      if (!raw && provider.id === "smtp") {
        raw = settings.get(LEGACY_SMTP[field.key] ?? "") ?? "";
        fromDatabase = raw !== "";
      }
      if (!raw && provider.id === "smtp") {
        const fromEnv: Record<string, unknown> = {
          host: EMAIL_CONFIG.host,
          port: EMAIL_CONFIG.port,
          secure: EMAIL_CONFIG.secure,
          user: EMAIL_CONFIG.auth?.user,
          pass: EMAIL_CONFIG.auth?.pass,
          from: EMAIL_CONFIG.from,
        };
        const v = fromEnv[field.key];
        raw = v === undefined || v === null ? "" : String(v);
      }

      out[field.key] =
        field.type === "secret" && raw && fromDatabase ? (decryptSecret(raw) ?? "") : raw;
    }
    return out;
  }

  /**
   * Store what an operator typed.
   *
   * Secrets are encrypted here, and a secret left blank means LEAVE IT ALONE
   * rather than "clear it": the browser is never sent the current value, so a
   * blank field is the normal state of an unedited form, and treating it as a
   * deletion would wipe the credential every time somebody changed the sender
   * address.
   */
  public saveConfig(providerId: string, values: Record<string, unknown>): void {
    const provider = providerById(providerId);
    if (!provider) throw new Error(`unknown mail provider: ${providerId}`);
    const settings = SettingsService.getInstance();

    for (const field of provider.fields) {
      const given = values[field.key];
      if (given === undefined) continue;
      const asString = typeof given === "boolean" ? String(given) : String(given ?? "");

      if (field.type === "secret") {
        if (asString.trim() === "") continue; // unedited, not cleared
        settings.set(settingKey(providerId, field.key), encryptSecret(asString));
      } else {
        settings.set(settingKey(providerId, field.key), asString);
      }
    }
    settings.set("mail_provider", providerId);
  }

  /**
   * What the Settings screen needs to draw the form.
   *
   * NEVER the secret values - only whether each one is present. A screen that
   * shows a credential is a screen that leaks it to anybody who reaches an
   * admin session, and there is no reason to show it: the operator is either
   * changing it or leaving it.
   */
  public describeConfig(providerId: string): {
    provider: string;
    fields: (ProviderField & { value?: string; isSet?: boolean })[];
  } {
    const provider = providerById(providerId) ?? smtpProvider;
    const resolved = this.resolveConfig(provider);
    return {
      provider: provider.id,
      fields: provider.fields.map((f) =>
        f.type === "secret"
          ? { ...f, isSet: !!resolved[f.key] }
          : { ...f, value: resolved[f.key] ?? "" }
      ),
    };
  }

  /** Is the selected provider actually usable? */
  public isConfigured(): boolean {
    const provider = providerById(this.selectedProviderId());
    if (!provider) return false;
    const config = this.resolveConfig(provider);
    return provider.fields
      .filter((f) => f.required)
      .every((f) => (config[f.key] ?? "").trim() !== "");
  }

  public async send(msg: MailMessage): Promise<SendResult> {
    const provider = providerById(this.selectedProviderId());
    if (!provider) {
      return { ok: false, error: "No mail provider is selected." };
    }
    const config = this.resolveConfig(provider);
    const result = await provider.send(config, msg);

    if (!result.ok) {
      // The RECIPIENT is not logged. A log of who was sent a verification code
      // is a log of who has an account, and it ends up in the shared log view.
      Logger.getInstance().warn(`[mail] ${provider.label} did not send: ${result.error}`);
    }
    return result;
  }

  /** Prove it works, before an operator finds out from a locked-out user. */
  public async verify(to: string): Promise<SendResult> {
    const provider = providerById(this.selectedProviderId());
    return this.send({
      to,
      subject: "EZPipeline test message",
      text:
        `This is a test from EZPipeline, sent through ${provider?.label ?? "the configured provider"}.\n\n` +
        `If you are reading it, verification codes and notifications will arrive too.`,
    });
  }
}
