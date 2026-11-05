import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';

/**
 * CSV builders for administrator exports.
 *
 * Rules applied throughout:
 *  * Row sets are bounded and ordered deterministically so exports are reviewable.
 *  * No credentials, tokens or hashes are ever included.
 *  * Children's data is limited to what a school legitimately needs in a register.
 *  * Cell values are escaped (quotes/newlines/commas) so spreadsheet software
 *    cannot be tricked into executing content from a name or note field.
 */
@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private static escape(value: unknown): string {
    if (value === null || value === undefined) return '';
    let text = String(value);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  private toCsv(headers: string[], rows: unknown[][]): string {
    const lines = [headers.map((h) => ExportsService.escape(h)).join(',')];
    for (const row of rows) lines.push(row.map((cell) => ExportsService.escape(cell)).join(','));
    // BOM keeps Excel happy with the UTF-8 characters in Kenyan names.
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  private stamped(prefix: string): string {
    return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  }

  async recordExport(user: AuthPrincipal, name: string, filename: string): Promise<void> {
    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'data.exported',
      entityType: 'Export',
      entityId: null,
      summary: `Exported ${name} (${filename})`,
    });
  }

  async learnersCsv(user: AuthPrincipal) {
    const learners = await this.prisma.learner.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ grade: { level: 'asc' } }, { lastName: 'asc' }, { firstName: 'asc' }],
      take: 5000,
      include: {
        grade: { select: { name: true } },
        currentClass: { select: { name: true } },
        parentLinks: {
          where: { revokedAt: null },
          select: { isVerified: true, relationship: true, parentProfile: { select: { user: { select: { fullName: true, phone: true } } } } },
        },
      },
    });

    return {
      filename: this.stamped('learner-register'),
      body: this.toCsv(
        [
          'Admission number', 'Assessment number', 'UPI number', 'First name', 'Middle name', 'Last name', 'Gender',
          'Date of birth', 'Grade', 'Class', 'Status', 'Enrolled on', 'Boarding', 'Special needs',
          'Guardians', 'Verified guardians',
        ],
        learners.map((l) => [
          l.admissionNumber, l.assessmentNumber, l.upiNumber, l.firstName, l.middleName, l.lastName, l.gender,
          l.dateOfBirth ? l.dateOfBirth.toISOString().slice(0, 10) : '',
          l.grade?.name, l.currentClass?.name, l.status,
          l.enrolledOn ? l.enrolledOn.toISOString().slice(0, 10) : '', l.isBoarding ? 'YES' : 'NO', l.specialNeeds,
          l.parentLinks.map((p) => `${p.parentProfile.user.fullName} (${p.relationship})`).join(' | '),
          String(l.parentLinks.filter((p) => p.isVerified).length),
        ]),
      ),
    };
  }

  async teachersCsv(user: AuthPrincipal) {
    const teachers = await this.prisma.teacherProfile.findMany({
      where: { schoolId: user.schoolId, user: { archivedAt: null } },
      orderBy: { user: { fullName: 'asc' } },
      take: 1000,
      include: {
        user: { select: { fullName: true, email: true, phone: true, isActive: true } },
        assignments: { where: { isActive: true }, select: { lessonsPerWeek: true, learningArea: { select: { name: true } }, class: { select: { name: true } } } },
        availability: { where: { isAvailable: false }, select: { id: true } },
      },
    });

    return {
      filename: this.stamped('teaching-staff'),
      body: this.toCsv(
        [
          'Staff number', 'TSC number', 'Full name', 'Email', 'Phone', 'Employment', 'Active',
          'Max periods/day', 'Max periods/week', 'Assignments', 'Weekly periods', 'Unavailable slots', 'Classes', 'Learning areas',
        ],
        teachers.map((t) => [
          t.staffNumber, t.tscNumber, t.user.fullName, t.user.email, t.user.phone, t.employmentType, t.user.isActive ? 'YES' : 'NO',
          t.maxPeriodsPerDay, t.maxPeriodsPerWeek, t.assignments.length,
          t.assignments.reduce((sum, a) => sum + (a.lessonsPerWeek ?? 0), 0),
          t.availability.length,
          Array.from(new Set(t.assignments.map((a) => a.class.name))).join(' | '),
          Array.from(new Set(t.assignments.map((a) => a.learningArea.name))).join(' | '),
        ]),
      ),
    };
  }

  async resultsCsv(user: AuthPrincipal, filters: { termId?: string; classId?: string }) {
    // Built as a typed value (rather than spread inline) so Prisma keeps the
    // `include` relations in the inferred result type.
    const where: Prisma.AssessmentResultWhereInput = { schoolId: user.schoolId };
    if (filters.classId || filters.termId) {
      where.assessment = {
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.termId ? { termId: filters.termId } : {}),
      };
    }

    const results = await this.prisma.assessmentResult.findMany({
      where,
      orderBy: [{ assessment: { assessmentDate: 'asc' } }, { learner: { lastName: 'asc' } }],
      take: 20000,
      include: {
        learner: { select: { firstName: true, lastName: true, admissionNumber: true } },
        assessment: { select: { title: true, assessmentDate: true, totalMarks: true, status: true, category: { select: { name: true } }, learningArea: { select: { name: true } }, class: { select: { name: true } } } },
        achievementLevel: { select: { label: true, code: true } },
      },
    });

    return {
      filename: this.stamped('assessment-results'),
      body: this.toCsv(
        [
          'Assessment date', 'Class', 'Learning area', 'Assessment', 'Category', 'Assessment status',
          'Admission number', 'Learner', 'Score', 'Out of', 'Percent', 'School band', 'Result status',
          'Absent', 'Excused', 'Comment',
        ],
        results.map((r) => {
          const total = r.assessment.totalMarks ? Number(r.assessment.totalMarks) : null;
          const score = r.numericScore != null ? Number(r.numericScore) : null;
          return [
            r.assessment.assessmentDate.toISOString().slice(0, 10),
            r.assessment.class.name, r.assessment.learningArea.name, r.assessment.title, r.assessment.category.name,
            r.assessment.status, r.learner.admissionNumber, `${r.learner.firstName} ${r.learner.lastName}`,
            score, total, score != null && total ? Math.round((score / total) * 1000) / 10 : '',
            // "School band" is the school's own achievement level - never a national grade.
            r.achievementLevel ? `${r.achievementLevel.label} (${r.achievementLevel.code})` : '', r.status, r.isAbsent ? 'YES' : 'NO', r.isExcused ? 'YES' : 'NO', r.comment,
          ];
        }),
      ),
    };
  }

  async timetableCsv(user: AuthPrincipal, versionId?: string) {
    const version = versionId
      ? await this.prisma.timetableVersion.findFirst({
          where: { id: versionId, schoolId: user.schoolId },
          include: { timetable: { select: { academicYearId: true, termId: true } } },
        })
      : await this.prisma.timetableVersion.findFirst({
          where: { schoolId: user.schoolId, status: 'PUBLISHED' },
          orderBy: { publishedAt: 'desc' },
          include: { timetable: { select: { academicYearId: true, termId: true } } },
        });
    if (!version) {
      return { filename: this.stamped('timetable'), body: this.toCsv(['Note'], [['No published timetable yet']]) };
    }

    const entries = await this.prisma.timetableEntry.findMany({
      where: { versionId: version.id },
      orderBy: [{ class: { name: 'asc' } }, { dayOfWeek: 'asc' }, { sequence: 'asc' }],
      take: 20000,
      include: {
        class: { select: { name: true } },
        learningArea: { select: { name: true } },
        teacher: { select: { user: { select: { fullName: true } } } },
        room: { select: { name: true } },
      },
    });
    // The bell schedule belongs to the term (every class shares it), not to a
    // single timetable version.
    const periods = await this.prisma.timetablePeriod.findMany({
      where: {
        schoolId: user.schoolId,
        academicYearId: version.timetable.academicYearId,
        ...(version.timetable.termId ? { termId: version.timetable.termId } : {}),
      },
      select: { id: true, label: true, startTime: true, endTime: true },
    });
    const periodById = new Map(periods.map((p) => [p.id, p]));

    return {
      filename: `${this.stamped('timetable').replace('.csv', '')}-v${version.versionNumber}.csv`,
      body: this.toCsv(
        ['Class', 'Day', 'Sequence', 'Period', 'Start', 'End', 'Learning area', 'Teacher', 'Room', 'Double lesson'],
        entries.map((e) => {
          const period = periodById.get(e.periodId);
          return [
            e.class.name, e.dayOfWeek, e.sequence, period?.label ?? '', period?.startTime ?? '', period?.endTime ?? '',
            e.learningArea.name, e.teacher?.user.fullName ?? '', e.room?.name ?? '', e.isDoubleLesson ? 'YES' : 'NO',
          ];
        }),
      ),
    };
  }
}
