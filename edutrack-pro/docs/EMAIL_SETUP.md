# Email setup

In-app notifications work out of the box: they are rows in `Notification`, shown in the web app's
bell/notification screens, the mobile inbox and the parent dashboard counter. **Email is optional and
is not configured by default.**

## 1. How it behaves now

* `EMAIL_PROVIDER=console` (the default) — the notifications service records what *would* be sent and
  logs a summary line only (recipient count, notification type). No message body, no recipient
  address and no learner name is written to the log.
* Each notification row stores an `emailStatus`, so the UI can show that delivery is pending rather
  than pretending it happened. The mobile/web inbox is the reliable channel.
* Marking an email as delivered only happens when a real provider accepts it.

## 2. Switching to real email

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM="EduTrack Pro <no-reply@your-school.ac.ke>"
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASSWORD=your-password-or-app-key
SMTP_SECURE=false        # true for implicit TLS (usually port 465)
```

Restart the API. Verification steps:

1. `GET /api/v1/health/ready` still reports healthy.
2. Publish a result for an assessment with a guardian who has not muted that notification type.
3. Confirm the message arrives and that `Notification.emailStatus` becomes sent (visible via
   `GET /api/v1/notifications`).

## 3. Consent and preference rules

* Guardians control their own delivery: `GET/PATCH /api/v1/notifications/preferences` stores
  `inAppEnabled`, `emailEnabled` and a `mutedTypes` list validated against the shared
  `NOTIFICATION_TYPE_VALUES`, so an unknown type cannot be silently muted.
* Email is only a *copy* of an in-app notification — muting a type never hides the record from the
  inbox, and no email is ever the only evidence that something happened.
* Only sign-in accounts receive email. Learners have no accounts (and therefore no email), and
  learners' personal data is never included in a subject line.

## 4. Recommended provider settings

| Setting | Recommendation |
| --- | --- |
| Domain authentication | SPF + DKIM + DMARC on the sending domain, so school mail is not filtered as spam |
| From address | a monitored mailbox (`no-reply@` plus a reply-to the school office) |
| Deliverability | use a transactional provider (SES, Postmark, SendGrid, Mailgun, ZeptoMail…) rather than raw SMTP from a school server |
| PII | keep names out of subject lines; require TLS; disable open-tracking pixels if local policy forbids them |

## 5. What is left to configure (not done in this repository)

* No provider credentials are included anywhere — supply your own via environment variables.
* No bounce/complaint webhook handling: a hard-bounced address is logged, not automatically disabled.
  Add that before using email as a primary channel at scale.
* No digest/batching: each notification is an individual message. Add batching if a large school finds
  the volume noisy.
