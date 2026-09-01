import nodemailer from 'nodemailer';
import Logger from '../controllers/Logger.js';
import { SettingsService } from './SettingsService.js';
import { EMAIL_CONFIG } from '../config/index.js';

export class EmailService {
    private static instance: EmailService;
    private fallbackTransporter: nodemailer.Transporter | null = null;

    private constructor() {
        // Initialize fallback transporter from centralized config
        if (EMAIL_CONFIG.enabled && EMAIL_CONFIG.host) {
            this.fallbackTransporter = nodemailer.createTransport({
                host: EMAIL_CONFIG.host,
                port: EMAIL_CONFIG.port,
                secure: EMAIL_CONFIG.secure,
                auth: {
                    user: EMAIL_CONFIG.auth.user,
                    pass: EMAIL_CONFIG.auth.pass
                }
            });
        }
    }

    public static getInstance(): EmailService {
        if (!EmailService.instance) {
            EmailService.instance = new EmailService();
        }
        return EmailService.instance;
    }

    private getTransporter(): { transporter: nodemailer.Transporter | null, from: string } {
        // Try to get settings from DB
        const settings = SettingsService.getInstance().getMultiple(['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from']);

        if (settings.smtp_host) {
            const transporter = nodemailer.createTransport({
                host: settings.smtp_host,
                port: parseInt(settings.smtp_port || '587'),
                secure: settings.smtp_secure === 'true',
                auth: {
                    user: settings.smtp_user || '',
                    pass: settings.smtp_pass || '' // TODO: Handle decryption if we encrypt later
                }
            });
            return {
                transporter,
                from: settings.smtp_from || '"EZPipeline" <noreply@ezpipeline.io>'
            };
        }

        // Fallback
        return {
            transporter: this.fallbackTransporter,
            from: EMAIL_CONFIG.from || '"EZPipeline" <noreply@ezpipeline.io>'
        };
    }

    public async sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
        const { transporter, from } = this.getTransporter();

        if (!transporter) {
            Logger.getInstance().warn('EmailService: No transporter configured. Skipping email.');
            Logger.getInstance().info(`[MOCK EMAIL] To: ${to}, Subject: ${subject}, Text: ${text}`);
            return false;
        }

        try {
            await transporter.sendMail({
                from,
                to,
                subject,
                text,
                html
            });
            return true;
        } catch (error) {
            Logger.getInstance().error('EmailService: Failed to send email', error);
            return false;
        }
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
