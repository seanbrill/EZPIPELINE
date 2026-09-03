// What a mail provider is, from this application's point of view.

/** One message. Deliberately small: this app sends codes and notices, not campaigns. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  ok: boolean;
  /**
   * Why it failed, in words an operator can act on.
   *
   * Every provider maps its own failure into this, because "401" from six
   * different APIs means six different things to fix and the operator should
   * not have to know which service they picked to read the error.
   */
  error?: string;
}

/**
 * One field an operator fills in.
 *
 * The UI is generated from these rather than hand-written per provider, so
 * adding a provider cannot leave a form that does not match what the server
 * reads - which is exactly how the SMTP form and the SMTP route drifted into
 * storing a password the GET route then handed straight back.
 */
export interface ProviderField {
  key: string;
  label: string;
  /** `secret` is encrypted at rest and never returned to the browser. */
  type: "text" | "number" | "boolean" | "secret";
  placeholder?: string;
  required: boolean;
  /** Shown under the field. Say what it is and where to find it. */
  hint?: string;
}

export interface MailProvider {
  id: string;
  label: string;
  /** One line in the picker: what this is and who it suits. */
  blurb: string;
  fields: readonly ProviderField[];
  /** Send, having been given the resolved config (secrets already decrypted). */
  send(config: Record<string, string>, msg: MailMessage): Promise<SendResult>;
}

/** A config value that is present and not just whitespace. */
export function present(config: Record<string, string>, key: string): string | null {
  const v = (config[key] ?? "").trim();
  return v === "" ? null : v;
}

/**
 * The same missing-configuration answer from every provider.
 *
 * Blank counts as absent everywhere here. This has been got wrong repeatedly
 * across both of these projects, always the same way: `??` does not fire on an
 * empty string, so an unset field becomes an empty credential handed to an API
 * that then reports something unrelated.
 */
export function missing(provider: string, keys: string[]): SendResult {
  return {
    ok: false,
    error:
      `${provider} is selected but not configured: ${keys.join(", ")} ` +
      `${keys.length === 1 ? "is" : "are"} empty. Set ${keys.length === 1 ? "it" : "them"} ` +
      `in Settings, or choose a different provider.`,
  };
}

/** An HTTP failure, with the body, because the body is where the reason is. */
export async function httpFailure(provider: string, res: Response): Promise<SendResult> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 400);
  } catch {
    /* a body we cannot read is still a status worth reporting */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? " The API key is wrong, revoked, or lacks permission to send."
      : res.status === 422 || res.status === 400
        ? " The sender address is usually the cause: it has to be one this provider has verified."
        : res.status === 429
          ? " Rate limited by the provider; it will work again shortly."
          : "";
  return { ok: false, error: `${provider} refused the message (HTTP ${res.status}).${hint} ${detail}`.trim() };
}
