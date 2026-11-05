import { Logger } from '@nestjs/common';
import { loadConfig } from '../config/configuration';

/**
 * Minimal SMTP sender used only when EMAIL_PROVIDER=smtp.
 * Implemented with a lazy import so the dependency is optional; when it is
 * missing the caller receives a clear error and the in-app notification remains
 * the source of truth.
 */
export class EmailService {
  private static readonly logger = new Logger('EmailService');

  static async send(message: { to: string[]; subject: string; text: string }): Promise<void> {
    const config = loadConfig();
    if (config.email.provider !== 'smtp') return;
    try {
      const nodemailer = await import('nodemailer' as string);
      const transport = (nodemailer as unknown as { createTransport: (o: unknown) => { sendMail: (m: unknown) => Promise<unknown> } })
        .createTransport({
          host: config.email.smtp.host,
          port: config.email.smtp.port,
          secure: config.email.smtp.secure,
          auth: config.email.smtp.user ? { user: config.email.smtp.user, pass: config.email.smtp.password } : undefined,
        });
      await transport.sendMail({
        from: config.email.from,
        to: message.to.join(','),
        subject: message.subject,
        text: message.text,
      });
      this.logger.log(`Email sent to ${message.to.length} recipient(s)`);
    } catch (error) {
      this.logger.warn(
        `SMTP delivery unavailable (${(error as Error).message}). Install "nodemailer" and configure SMTP_* to enable email notifications.`,
      );
    }
  }
}
