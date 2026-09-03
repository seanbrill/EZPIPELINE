// The mail API the rest of the app calls.
//
// A thin face over services/mail, kept at this name and shape so the four
// existing call sites did not have to change as part of adding providers. All
// it does now is compose the two messages this app actually sends; choosing a
// provider, resolving its configuration and decrypting its credentials belong
// to MailService.

import Logger from '../controllers/Logger.js';
import { MailService } from './mail/index.js';

export class EmailService {
    private static instance: EmailService;
    private constructor() { }

    public static getInstance(): EmailService {
        if (!EmailService.instance) {
            EmailService.instance = new EmailService();
        }
        return EmailService.instance;
    }

    /**
     * Returns whether it sent, as it always did.
     *
     * The REASON goes to the log rather than to the caller, because every
     * caller here is a route that must not fail because mail failed - a
     * verification code that cannot be sent is a sign-in to refuse, not a 500
     * to raise. Callers wanting the reason should use MailService directly.
     */
    public async sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
        const result = await MailService.getInstance().send({ to, subject, text, html });
        if (!result.ok && !MailService.getInstance().isConfigured()) {
            // Said once and plainly. Previously this logged the entire message
            // body as a "[MOCK EMAIL]" line, which put verification codes in
            // the shared log view in plain text - readable by anyone who could
            // open the dashboard.
            Logger.getInstance().warn(
                '[mail] no provider is configured, so nothing was sent. ' +
                'Configure one in Settings > General.'
            );
        }
        return result.ok;
    }

    public async sendMFACode(email: string, code: string): Promise<boolean> {
        const subject = 'Your EZPipeline Verification Code';
        const text = `Your verification code is: ${code}\n\nThis code will expire in 10 minutes.`;
        const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #10B981;">EZPipeline</h1>
                <p>Your verification code is:</p>
                <div style="background: #f3f4f6; padding: 20px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px; border-radius: 8px;">
                    ${code}
                </div>
                <p>This code will expire in 10 minutes.</p>
                <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">If you didn't request this, please ignore this email.</p>
            </div>
        `;
        return this.sendEmail(email, subject, text, html);
    }
}
