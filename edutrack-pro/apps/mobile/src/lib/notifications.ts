import { NOTIFICATION_TYPE_VALUES, type NotificationTypeValue } from '@edutrack/validation';

/**
 * Notification labels.
 *
 * The list of valid types comes from the shared validation package, so the mobile
 * app, the web app and the API can never drift apart: if a type is added on the
 * server, `Record<NotificationTypeValue, string>` below fails to compile here until
 * a label is written.
 */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationTypeValue, string> = {
  ASSESSMENT_PUBLISHED: 'Result published',
  NEW_RESOURCE: 'New learning resource',
  NEW_ASSIGNMENT: 'New assignment',
  ASSIGNMENT_SUBMITTED: 'Work handed in',
  SUBMISSION_REVIEWED: 'Hand-in reviewed',
  TEACHER_FEEDBACK: 'Teacher feedback',
  TIMETABLE_PUBLISHED: 'Timetable published',
  TIMETABLE_CHANGED: 'Timetable changed',
  SCHOOL_ANNOUNCEMENT: 'School announcement',
  ACCOUNT: 'Account',
};

export function notificationLabel(type: string): string {
  return (NOTIFICATION_TYPE_LABELS as Record<string, string>)[type] ?? type.replace(/_/g, ' ').toLowerCase();
}

export const NOTIFICATION_TYPE_COUNT = NOTIFICATION_TYPE_VALUES.length;
