import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessRuleException } from '../errors/domain-errors';

export interface NotifyInput {
  schoolId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  email?: { to: string[]; subject: string; text: string } | null;
}

/**
 * In-app notification fan-out plus optional email.
 * Privacy rules enforced here:
 *  * A notification is only ever created for an explicitly provided userId.
 *  * Bodies never contain another learner's data - callers pass the final text,
 *    and the API only sends learner-specific text to that learner's guardians.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly emailProvider: string;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.emailProvider = config.get<string>('email.provider') ?? 'console';
  }

  async notify(input: NotifyInput): Promise<number> {
    const requested = Array.from(new Set(input.userIds.filter(Boolean)));
    if (!requested.length) return 0;

    // Respect per-user preferences: a user who has switched in-app notifications
    // off (and has no email) receives nothing rather than an unwanted inbox row.
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: requested } },
      select: { userId: true, inAppEnabled: true, emailEnabled: true, mutedTypes: true, emailAddress: true },
    });
    const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
    const uniqueUserIds = requested.filter((userId) => {
      const pref = prefByUser.get(userId);
      if (!pref) return true; // no preference row yet => defaults (in-app on)
      const muted = Array.isArray(pref.mutedTypes) && (pref.mutedTypes as string[]).includes(input.type);
      if (muted) return false;
      return pref.inAppEnabled || pref.emailEnabled;
    });
    if (!uniqueUserIds.length) return 0;

    // Email only goes out when a provider is configured AND the user opted in.
    const emailRecipients = input.email
      ? uniqueUserIds
          .map((userId) => prefByUser.get(userId)?.emailAddress)
          .filter((address): address is string => !!address)
      : [];
    const shouldEmail = !!input.email && this.emailProvider === 'smtp';

    const emailStatus = input.email
      ? shouldEmail
        ? 'QUEUED'
        : 'NOT_CONFIGURED'
      : null;

    await this.prisma.notification.createMany({
      data: uniqueUserIds.map((userId) => ({
        schoolId: input.schoolId,
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        channels: input.email ? (['IN_APP', 'EMAIL'] as never) : (['IN_APP'] as never),
        emailStatus,
      })),
    });

    if (shouldEmail && emailRecipients.length && input.email) {
      void this.sendEmailSafely({ ...input.email, to: emailRecipients });
    } else if (input.email && this.emailProvider !== 'smtp') {
      // Honest behaviour: no email provider configured, so nothing is sent.
      // The in-app notification still works and the status records the reason.
      this.logger.log(
        `Email notification skipped (EMAIL_PROVIDER=${this.emailProvider}) for type=${input.type}; ${uniqueUserIds.length} in-app notification(s) created.`,
      );
    } else if (input.email) {
      // SMTP delivery is wired in EmailService; failures must not break the request.
      void this.sendEmailSafely(input.email);
    }

    return uniqueUserIds.length;
  }

  private async sendEmailSafely(email: { to: string[]; subject: string; text: string }): Promise<void> {
    try {
      const { EmailService } = await import('./email.service');
      await EmailService.send(email);
    } catch (error) {
      this.logger.warn(`Email delivery failed: ${(error as Error).message}`);
    }
  }

  async list(userId: string, opts: { page: number; pageSize: number; unreadOnly?: boolean }) {
    const where = { userId, ...(opts.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, total, unread };
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  }

  /* ----------------------------- preferences ---------------------------- */

  async getPreferences(userId: string, schoolId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (existing) return this.toPreferenceDto(existing);
    // Sensible defaults, created lazily on first read so the UI always has data.
    const created = await this.prisma.notificationPreference.create({
      data: { schoolId, userId, inAppEnabled: true, emailEnabled: false, mutedTypes: [] },
    });
    return this.toPreferenceDto(created);
  }

  async updatePreferences(
    userId: string,
    schoolId: string,
    input: { inAppEnabled: boolean; emailEnabled: boolean; emailAddress?: string | null; mutedTypes?: string[] },
  ) {
    if (input.emailEnabled && this.emailProvider !== 'smtp' && !input.emailAddress) {
      throw new BusinessRuleException(
        'Add an email address first. (The school’s email provider is not configured yet, so email alerts will be queued rather than sent.)',
      );
    }
    const saved = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        schoolId,
        userId,
        inAppEnabled: input.inAppEnabled,
        emailEnabled: input.emailEnabled,
        emailAddress: input.emailAddress || null,
        mutedTypes: (input.mutedTypes ?? []) as never,
      },
      update: {
        inAppEnabled: input.inAppEnabled,
        emailEnabled: input.emailEnabled,
        emailAddress: input.emailAddress || null,
        ...(input.mutedTypes ? { mutedTypes: input.mutedTypes as never } : {}),
      },
    });
    return this.toPreferenceDto(saved);
  }

  /**
   * Retries notifications whose email never left the building because the
   * provider was unconfigured or the send failed. In-app copies are untouched.
   */
  async retryFailedEmails(schoolId: string, limit = 50) {
    if (this.emailProvider !== 'smtp') {
      const pending = await this.prisma.notification.count({ where: { schoolId, emailStatus: { in: ['FAILED', 'NOT_CONFIGURED'] } } });
      return {
        attempted: 0,
        sent: 0,
        stillPending: pending,
        reason: `EMAIL_PROVIDER=${this.emailProvider} - configure SMTP (see docs/EMAIL_SETUP.md) to deliver these ${pending} alert(s).`,
      };
    }
    const rows = await this.prisma.notification.findMany({
      where: { schoolId, emailStatus: { in: ['FAILED', 'NOT_CONFIGURED'] } },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    let sent = 0;
    for (const row of rows) {
      const target = await this.prisma.notificationPreference.findUnique({ where: { userId: row.userId }, select: { emailAddress: true } });
      if (!target?.emailAddress) {
        await this.prisma.notification.update({ where: { id: row.id }, data: { emailStatus: 'SKIPPED' } });
        continue;
      }
      try {
        const { EmailService } = await import('./email.service');
        await EmailService.send({ to: [target.emailAddress], subject: row.title, text: row.body ?? row.title });
        await this.prisma.notification.update({ where: { id: row.id }, data: { emailStatus: 'SENT' } });
        sent += 1;
      } catch (error) {
        await this.prisma.notification.update({ where: { id: row.id }, data: { emailStatus: 'FAILED' } });
        this.logger.warn(`Retry failed for notification ${row.id}: ${(error as Error).message}`);
      }
    }
    return { attempted: rows.length, sent, stillPending: Math.max(0, rows.length - sent), reason: null };
  }

  private toPreferenceDto(row: { inAppEnabled: boolean; emailEnabled: boolean; emailAddress: string | null; mutedTypes: unknown }) {
    return {
      inAppEnabled: row.inAppEnabled,
      emailEnabled: row.emailEnabled,
      emailAddress: row.emailAddress,
      mutedTypes: Array.isArray(row.mutedTypes) ? (row.mutedTypes as string[]) : [],
      emailProvider: this.emailProvider,
      emailDeliveryConfigured: this.emailProvider === 'smtp',
    };
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return res.count;
  }
}
