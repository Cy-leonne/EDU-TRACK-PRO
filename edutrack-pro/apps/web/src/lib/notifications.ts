import { NOTIFICATION_TYPE_VALUES } from '@edutrack/validation';

/**
 * Notification types and their human labels.
 *
 * The list is re-exported from the shared validation package rather than copied, so
 * the mute switches, the API schema and the notification writer all use one source
 * of truth. Adding a type on the server surfaces here immediately.
 */
export const NOTIFICATION_TYPES = NOTIFICATION_TYPE_VALUES;

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  ASSESSMENT_PUBLISHED: 'A result was published',
  NEW_RESOURCE: 'New learning material was shared',
  NEW_ASSIGNMENT: 'New assignment set',
  ASSIGNMENT_SUBMITTED: 'Work was handed in',
  SUBMISSION_REVIEWED: 'A hand-in was reviewed',
  TEACHER_FEEDBACK: 'Narrative feedback was added',
  TIMETABLE_PUBLISHED: 'A new timetable was published',
  TIMETABLE_CHANGED: 'The timetable changed',
  SCHOOL_ANNOUNCEMENT: 'School announcement',
  ACCOUNT: 'Account and security messages',
};
