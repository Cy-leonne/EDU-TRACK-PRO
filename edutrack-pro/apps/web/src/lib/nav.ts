import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MailPlus,
  Library,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Role } from './types';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  /** Hidden when the role lacks the permission, but always visible to the roles listed. */
  roles: Role[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const homeFor = (role: Role) => (role === 'SUPERADMIN' ? '/admin/dashboard' : '/dashboard');

const TEACHING_SECTIONS: NavSection[] = [
  {
    title: 'Teaching',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['TEACHER', 'CLASS_TEACHER'] },
      { href: '/teaching/classes', label: 'My classes', icon: BookOpen, roles: ['TEACHER', 'CLASS_TEACHER'] },
      { href: '/teaching/timetable', label: 'My timetable', icon: CalendarDays, roles: ['TEACHER', 'CLASS_TEACHER'] },
    ],
  },
  {
    title: 'Assessment',
    items: [
      { href: '/teaching/assessments', label: 'Assessments', icon: ClipboardCheck, roles: ['TEACHER', 'CLASS_TEACHER'] },
      { href: '/teaching/submissions', label: 'Hand-ins', icon: ListChecks, roles: ['TEACHER', 'CLASS_TEACHER'] },
      { href: '/teaching/resources', label: 'Resources & assignments', icon: Library, roles: ['TEACHER', 'CLASS_TEACHER'] },
    ],
  },
  {
    title: 'Account',
    items: [{ href: '/account', label: 'My account', icon: Settings, roles: ['TEACHER', 'CLASS_TEACHER'] }],
  },
];

export const NAV: Record<Role, NavSection[]> = {
  // Platform operators have a separate authenticated /admin portal and do not
  // receive a school workspace sidebar.
  SUPERADMIN: [],
  ADMIN: [
    {
      title: 'Overview',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN'] },
        { href: '/reports', label: 'Reports & exports', icon: FileText, permission: 'report:read:school', roles: ['ADMIN'] },
      ],
    },
    {
      title: 'People',
      items: [
        { href: '/people/teachers', label: 'Teachers', icon: GraduationCap, permission: 'teacher:read', roles: ['ADMIN'] },
        { href: '/admin/class-teachers', label: 'Class teacher assignments', icon: ShieldCheck, permission: 'class-teacher:assign', roles: ['ADMIN'] },
        { href: '/people/learners', label: 'Learners', icon: Users, permission: 'learner:read', roles: ['ADMIN'] },
        { href: '/people/parents', label: 'Parents & links', icon: Users, permission: 'parent:read', roles: ['ADMIN'] },
        { href: '/people/invitations', label: 'Invitations', icon: MailPlus, permission: 'user:manage', roles: ['ADMIN'] },
      ],
    },
    {
      title: 'Academics',
      items: [
        { href: '/academics/classes', label: 'Classes & enrolment', icon: BookOpen, permission: 'class:read', roles: ['ADMIN'] },
        { href: '/academics/learning-areas', label: 'Learning areas', icon: Library, permission: 'learning-area:read', roles: ['ADMIN'] },
        { href: '/academics/assignments', label: 'Teaching assignments', icon: ListChecks, permission: 'teacher-assignment:read', roles: ['ADMIN'] },
        { href: '/academics/calendar', label: 'Years & terms', icon: CalendarDays, permission: 'academic-year:read', roles: ['ADMIN'] },
      ],
    },
    {
      title: 'Timetable',
      items: [
        { href: '/timetable', label: 'Timetable workspace', icon: CalendarDays, permission: 'timetable:read', roles: ['ADMIN'] },
      ],
    },
    {
      title: 'Administration',
      items: [
        { href: '/settings/school', label: 'School settings', icon: Settings, permission: 'school:update', roles: ['ADMIN'] },
        { href: '/settings/assessment', label: 'Assessment setup', icon: ClipboardCheck, permission: 'assessment:read', roles: ['ADMIN'] },
        { href: '/audit', label: 'Audit log', icon: ShieldCheck, permission: 'audit:read', roles: ['ADMIN'] },
      ],
    },
  ],
  TEACHER: TEACHING_SECTIONS,
  CLASS_TEACHER: [
    ...TEACHING_SECTIONS,
    {
      title: 'Class Teacher',
      items: [
        { href: '/class-teacher/results', label: 'Class results review', icon: ClipboardCheck, permission: 'class-teacher:results:review', roles: ['CLASS_TEACHER'] },
        { href: '/class-teacher/reports', label: 'Report cards', icon: FileText, permission: 'class-teacher:reports:manage', roles: ['CLASS_TEACHER'] },
        { href: '/class-teacher/interventions', label: 'Learner support', icon: ListChecks, permission: 'class-teacher:interventions:manage', roles: ['CLASS_TEACHER'] },
      ],
    },
  ],
  PARENT: [
    {
      title: 'My family',
      items: [
        { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['PARENT'] },
        { href: '/family/results', label: 'Results & progress', icon: ClipboardCheck, roles: ['PARENT'] },
        { href: '/family/timetable', label: 'Timetable', icon: CalendarDays, roles: ['PARENT'] },
        { href: '/family/assignments', label: 'Assignments', icon: BookOpen, roles: ['PARENT'] },
        { href: '/family/resources', label: 'Learning resources', icon: Library, roles: ['PARENT'] },
      ],
    },
    {
      title: 'Account',
      items: [
        { href: '/family/notifications', label: 'Notifications', icon: ListChecks, roles: ['PARENT'] },
        { href: '/account', label: 'My details', icon: Settings, roles: ['PARENT'] },
      ],
    },
  ],
};

export function visibleSections(role: Role, permissions: string[]): NavSection[] {
  return (NAV[role] ?? [])
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.permission || permissions.includes(item.permission) || role === 'ADMIN'),
    }))
    .filter((section) => section.items.length > 0);
}
