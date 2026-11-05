import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { AssessmentsService } from '../assessments/assessments.service';
import { ResultsService } from '../assessments/results.service';

/** Role-specific dashboards. Every query is scoped to what the caller may see. */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly assessments: AssessmentsService,
    private readonly results: ResultsService,
  ) {}

  async admin(user: AuthPrincipal) {
    const schoolId = user.schoolId;
    const context = await this.tenant.currentContext(schoolId);
    const academicYearId = context.school.currentAcademicYearId;

    const [
      teachers, learners, classes, parents, learningAreas, assessmentCounts, resources,
      timetables, publishedVersions, draftVersions, conflictCount, enrolByGrade, recentActivity, versions,
    ] = await Promise.all([
      this.prisma.teacherProfile.count({ where: { schoolId, isActive: true } }),
      this.prisma.learner.count({ where: { schoolId, status: 'ACTIVE' } }),
      this.prisma.class.count({ where: { schoolId, isActive: true } }),
      this.prisma.parentProfile.count({ where: { schoolId, isActive: true } }),
      this.prisma.learningArea.count({ where: { schoolId, isActive: true } }),
      this.prisma.assessment.groupBy({ by: ['status'], where: { schoolId }, _count: { _all: true } }),
      this.prisma.learningResource.count({ where: { schoolId, archivedAt: null } }),
      this.prisma.timetable.count({ where: { schoolId, archivedAt: null } }),
      this.prisma.timetable.count({ where: { schoolId, status: 'PUBLISHED' } }),
      this.prisma.timetable.count({ where: { schoolId, status: 'DRAFT' } }),
      this.prisma.timetableConflict.count({ where: { schoolId, severity: 'ERROR', resolvedAt: null } }),
      this.prisma.grade.findMany({
        where: { schoolId },
        orderBy: { level: 'asc' },
        include: { _count: { select: { learners: true, classes: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: { actor: { select: { fullName: true } } },
      }),
      this.prisma.timetableVersion.findMany({ where: { schoolId }, select: { id: true }, take: 50 }),
    ]);

    const statusCount = (status: string) => assessmentCounts.find((c) => c.status === status)?._count._all ?? 0;

    const [missingResults, teacherLoads, coverageGaps, parentLinkGaps, studentsWithoutClass] = await Promise.all([
      this.prisma.assessment.findMany({
        where: { schoolId, status: { in: ['DRAFT', 'READY_FOR_REVIEW'] } },
        take: 40,
        include: { class: { select: { id: true, name: true } }, learningArea: { select: { name: true } }, _count: { select: { results: true } } },
      }),
      this.prisma.teacherProfile.findMany({ where: { schoolId, isActive: true }, include: { user: { select: { fullName: true } } } }),
      this.prisma.classLearningAreaRequirement.count({
        where: { schoolId, class: { isActive: true }, learningArea: { assignments: { none: { isActive: true } } } },
      }),
      this.prisma.parentLearnerLink.count({ where: { schoolId, isVerified: false, revokedAt: null } }),
      this.prisma.learner.count({ where: { schoolId, status: 'ACTIVE', currentClassId: null } }),
    ]);

    const withMissing = await Promise.all(
      missingResults.map(async (assessment) => {
        const total = await this.prisma.classEnrollment.count({ where: { classId: assessment.classId, status: 'ACTIVE' } });
        return {
          id: assessment.id, title: assessment.title, className: assessment.class.name,
          learningAreaName: assessment.learningArea.name,
          entered: assessment._count.results, expected: total, missing: Math.max(0, total - assessment._count.results),
        };
      }),
    );

    const workloads = await Promise.all(
      teacherLoads.map(async (teacher) => {
        const assignments = await this.prisma.teacherAssignment.findMany({ where: { teacherId: teacher.id, isActive: true }, include: { class: { include: { requirements: true } } } });
        const assignedPeriods = assignments.reduce((sum, a) => {
          const requirement = a.class.requirements.find((r) => r.learningAreaId === a.learningAreaId);
          return sum + (requirement?.periodsPerWeek ?? a.lessonsPerWeek ?? 0);
        }, 0);
        return { teacherName: teacher.user.fullName, assignedPeriods, maxPeriodsPerWeek: teacher.maxPeriodsPerWeek };
      }),
    );

    const setupWarnings: { code: string; message: string; severity: 'ERROR' | 'WARNING'; link?: string }[] = [];
    if (!academicYearId) setupWarnings.push({ code: 'NO_ACADEMIC_YEAR', message: 'No current academic year is set.', severity: 'ERROR', link: '/admin/school' });
    if (!context.school.currentTermId) setupWarnings.push({ code: 'NO_CURRENT_TERM', message: 'No current term is set.', severity: 'ERROR', link: '/admin/school' });
    if (coverageGaps > 0) setupWarnings.push({ code: 'MISSING_TEACHER_ASSIGNMENT', message: `${coverageGaps} class/learning-area allocation(s) have no teacher assigned.`, severity: 'ERROR', link: '/admin/assignments' });
    if (parentLinkGaps > 0) setupWarnings.push({ code: 'UNVERIFIED_PARENT_LINKS', message: `${parentLinkGaps} parent–learner link(s) await verification.`, severity: 'WARNING', link: '/admin/parents' });
    if (studentsWithoutClass > 0) setupWarnings.push({ code: 'LEARNERS_WITHOUT_CLASS', message: `${studentsWithoutClass} active learner(s) are not in a class.`, severity: 'WARNING', link: '/admin/learners' });
    const periods = academicYearId ? await this.prisma.timetablePeriod.count({ where: { schoolId, academicYearId } }) : 0;
    if (periods === 0) setupWarnings.push({ code: 'NO_BELL_SCHEDULE', message: 'No bell schedule is configured, so timetables cannot be generated.', severity: 'ERROR', link: '/admin/timetables' });

    return {
      counts: {
        teachers, learners, classes, parents, learningAreas,
        assessments: assessmentCounts.reduce((sum, c) => sum + c._count._all, 0),
        resources,
      },
      academicContext: {
        academicYearName: context.academicYear?.name ?? null,
        termName: context.term?.name ?? null,
        termEndsOn: context.term?.endDate ? context.term.endDate.toISOString().slice(0, 10) : null,
      },
      assessmentOverview: {
        draft: statusCount('DRAFT'), readyForReview: statusCount('READY_FOR_REVIEW'),
        published: statusCount('PUBLISHED') + statusCount('CORRECTED'),
        missingResults: withMissing.reduce((sum, a) => sum + a.missing, 0),
        awaitingResults: withMissing.filter((a) => a.missing > 0).sort((a, b) => b.missing - a.missing).slice(0, 8),
      },
      timetableStatus: { timetables, published: publishedVersions, draft: draftVersions, openConflicts: conflictCount, versions: versions.length },
      setupWarnings,
      recentActivity: recentActivity.map((a) => ({
        id: a.id, action: a.action, summary: a.summary ?? a.entityType,
        actorName: a.actor?.fullName ?? 'System', createdAt: a.createdAt.toISOString(),
      })),
      enrolmentByGrade: enrolByGrade.map((g) => ({ gradeName: g.name, learners: g._count.learners, classes: g._count.classes })),
      teacherWorkload: workloads.filter((w) => w.assignedPeriods > 0).sort((a, b) => b.assignedPeriods - a.assignedPeriods).slice(0, 10),
    };
  }

  async teacher(user: AuthPrincipal) {
    const teacherId = await this.tenant.teacherProfileId(user);
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { teacherId, isActive: true },
      include: {
        class: { include: { grade: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } },
        learningArea: true,
      },
    });

    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { id: teacherId },
      include: { user: { select: { fullName: true, email: true } }, availability: { where: { isAvailable: false } } },
    });

    const classIds = [...new Set(assignments.map((a) => a.classId))];
    const assessmentDashboard = await this.assessments.dashboard(user);

    const recentResources = await this.prisma.learningResource.findMany({
      where: { schoolId: user.schoolId, OR: [{ createdById: user.userId }, { classId: { in: classIds } }], archivedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { class: { select: { name: true } }, learningArea: { select: { name: true } }, file: { select: { originalName: true, mimeType: true } } },
    });

    const timetable = await this.prisma.timetableVersion.findFirst({
      where: { schoolId: user.schoolId, status: { in: ['PUBLISHED', 'SUPERSEDED'] } },
      orderBy: { publishedAt: 'desc' },
    });
    const entries = timetable
      ? await this.prisma.timetableEntry.findMany({
          where: { versionId: timetable.id, teacherId, schoolId: user.schoolId },
          orderBy: [{ dayOfWeek: 'asc' }, { sequence: 'asc' }],
          include: { learningArea: true, class: { select: { name: true } }, room: { select: { name: true } }, period: true },
        })
      : [];

    const today = new Date().getUTCDay() === 0 ? 7 : new Date().getUTCDay();
    const lessonsFor = (day: number) => entries.filter((e) => e.dayOfWeek === day).map((e) => ({
      dayOfWeek: e.dayOfWeek, sequence: e.sequence, startTime: e.period.startTime, endTime: e.period.endTime,
      learningAreaName: e.learningArea.name, learningAreaColor: e.learningArea.colorHex,
      className: e.class.name, roomName: e.room?.name ?? null, periodLabel: e.period.label,
    }));

    const nextDay = [today, ...([1, 2, 3, 4, 5].filter((d) => d > today))][0] ?? 1;
    const upcoming = [nextDay, ...[1, 2, 3, 4, 5].filter((d) => d > nextDay)].flatMap((day) => lessonsFor(day)).slice(0, 8);

    const weeklyPeriods = entries.length;

    return {
      today: { dayOfWeek: today, lessons: lessonsFor(today) },
      upcoming,
      classes: [...new Map(assignments.map((a) => [a.classId, a.class])).entries()].map(([id, klass]) => ({
        id, name: klass.name, gradeName: klass.grade.name, gradeLevel: klass.grade.level,
        learnerCount: klass._count.enrollments, capacity: null, isActive: true,
        classTeacherId: null, classTeacherName: null, stream: null,
        gradeId: klass.gradeId, academicYearId: klass.academicYearId, academicYearName: '',
      })),
      learningAreas: [...new Map(assignments.map((a) => [a.learningAreaId, a.learningArea])).entries()].map(([id, area]) => ({
        id, code: area.code, name: area.name, shortName: area.shortName, colorHex: area.colorHex,
        isCore: area.isCore, isExamined: area.isExamined, defaultPeriodsPerWeek: area.defaultPeriodsPerWeek,
        order: area.order, isActive: area.isActive,
      })),
      assessments: {
        inProgress: assessmentDashboard.counts.drafts,
        awaitingPublication: assessmentDashboard.counts.awaitingReview,
        draftsWithMissingResults: assessmentDashboard.missingResults.length,
        recent: await this.prisma.assessment.findMany({
          where: { schoolId: user.schoolId, OR: [{ createdById: user.userId }, { classId: { in: classIds } }] },
          orderBy: { assessmentDate: 'desc' },
          take: 5,
          include: { class: { select: { name: true } }, learningArea: { select: { name: true } }, category: { select: { name: true } } },
        }).then((rows) => rows.map((r) => ({
          id: r.id, title: r.title, className: r.class.name, learningAreaName: r.learningArea.name,
          categoryName: r.category.name, status: r.status,
          assessmentDate: r.assessmentDate.toISOString().slice(0, 10),
        }))),
      },
      weeklyLoad: {
        totalPeriods: weeklyPeriods,
        maxPeriodsPerWeek: teacher?.maxPeriodsPerWeek ?? null,
        byDay: [1, 2, 3, 4, 5].map((day) => ({ dayOfWeek: day, periods: entries.filter((e) => e.dayOfWeek === day).length })),
      },
      recentResources: recentResources.map((r) => ({
        id: r.id, title: r.title, className: r.class.name, learningAreaName: r.learningArea.name,
        type: r.type, fileName: r.file?.originalName ?? null, publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(), visibleToParents: true,
      })),
      timetableStatus: {
        published: !!timetable,
        versionNumber: timetable?.versionNumber ?? null,
        publishedAt: timetable?.publishedAt?.toISOString() ?? null,
      },
      profile: {
        fullName: teacher?.user.fullName ?? user.fullName,
        email: teacher?.user.email ?? user.email,
        staffNumber: teacher?.staffNumber ?? null,
        maxPeriodsPerDay: teacher?.maxPeriodsPerDay ?? null,
        unavailableSlots: teacher?.availability.length ?? 0,
      },
    };
  }

  async parent(user: AuthPrincipal, selectedLearnerId?: string) {
    const parentId = await this.tenant.parentProfileId(user);
    const links = await this.prisma.parentLearnerLink.findMany({
      where: { schoolId: user.schoolId, parentProfileId: parentId, revokedAt: null },
      include: { learner: { include: { grade: true, currentClass: true } } },
      orderBy: [{ isVerified: 'desc' }, { createdAt: 'asc' }],
    });

    const verified = links.filter((l) => l.isVerified);
    const learner = selectedLearnerId
      ? verified.find((l) => l.learnerId === selectedLearnerId)
      : verified[0];
    if (selectedLearnerId && !learner) {
      // A parent selecting someone else's learner is simply told nothing exists.
      throw new (await import('../../common/errors/domain-errors')).TenantIsolationException('Learner');
    }

    const learners = links.map((link) => ({
      id: link.learnerId,
      fullName: `${link.learner.firstName} ${link.learner.lastName}`,
      admissionNumber: link.learner.admissionNumber,
      gradeName: link.learner.grade?.name ?? 'Not assigned',
      className: link.learner.currentClass?.name ?? 'Not assigned',
      classId: link.learner.currentClassId,
      gradeLevel: link.learner.grade?.level ?? null,
      relationship: link.relationship,
      isVerified: link.isVerified,
    }));

    const term = await this.tenant.currentContext(user.schoolId);

    const results = learner
      ? await this.prisma.assessmentResult.findMany({
          where: { learnerId: learner.learnerId, schoolId: user.schoolId, status: { in: ['PUBLISHED', 'AMENDED'] } },
          orderBy: { publishedAt: 'desc' },
          take: 10,
          include: {
            achievementLevel: true,
            assessment: { include: { learningArea: true, category: true } },
            feedback: { where: { isPublished: true }, include: { author: { select: { fullName: true } } } },
          },
        })
      : [];

    const classId = learner?.learner.currentClassId ?? null;
    const [resources, assignments, unread] = await Promise.all([
      classId
        ? this.prisma.learningResource.findMany({
            where: { schoolId: user.schoolId, classId, archivedAt: null, publishedAt: { not: null }, visibleToParents: true },
            orderBy: { publishedAt: 'desc' }, take: 6,
            include: { learningArea: { select: { name: true } }, file: { select: { originalName: true, mimeType: true } } },
          })
        : [],
      classId
        ? this.prisma.assignment.findMany({
            where: { schoolId: user.schoolId, classId, archivedAt: null, publishedAt: { not: null } },
            orderBy: [{ dueDate: 'asc' }], take: 6,
            include: { learningArea: { select: { name: true } } },
          })
        : [],
      this.prisma.notification.count({ where: { userId: user.userId, readAt: null } }),
    ]);

    // Reuses the same progress computation the parent results page uses, so the
    // dashboard and the detailed page can never disagree.
    const progress = learner ? await this.results.learnerProgress(user, learner.learnerId, term.term?.id) : [];

    return {
      learners,
      selectedLearnerId: learner?.learnerId ?? null,
      latestResults: results.map((r) => {
        const total = r.assessment.totalMarks ? Number(r.assessment.totalMarks) : null;
        const score = r.numericScore ? Number(r.numericScore) : null;
        return {
          id: r.id,
          assessmentTitle: r.assessment.title,
          learningAreaName: r.assessment.learningArea.name,
          categoryName: r.assessment.category.name,
          scoreLabel: score != null ? (total ? `${score} / ${total}` : `${score}`) : r.isAbsent ? 'Absent' : r.isExcused ? 'Excused' : '—',
          achievementLabel: r.achievementLevel?.label ?? null,
          publishedAt: r.publishedAt?.toISOString() ?? null,
        };
      }),
      recentFeedback: results
        .flatMap((r) => r.feedback.map((f) => ({ id: f.id, narrative: f.narrative, authorName: f.author.fullName, learningAreaName: r.assessment.learningArea.name, assessmentTitle: r.assessment.title, createdAt: f.createdAt.toISOString() })))
        .slice(0, 5),
      upcomingAssignments: assignments.map((a) => ({
        id: a.id, title: a.title, instructions: a.instructions,
        classId: a.classId, className: '', learningAreaId: a.learningAreaId, learningAreaName: a.learningArea.name,
        dueDate: a.dueDate?.toISOString().slice(0, 10) ?? null, maxScore: a.maxScore ? Number(a.maxScore) : null,
        publishedAt: a.publishedAt?.toISOString() ?? null, createdByName: '',
      })),
      recentResources: resources.map((r) => ({
        id: r.id, title: r.title, className: '', learningAreaName: r.learningArea.name, type: r.type,
        fileName: r.file?.originalName ?? null, publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(), visibleToParents: r.visibleToParents,
      })),
      progress: progress.map((area) => ({
        learningAreaName: area.learningAreaName, color: area.colorHex, points: area.points,
      })),
      unreadNotifications: unread,
      academicContext: { academicYearName: term.academicYear?.name ?? null, termName: term.term?.name ?? null },
    };
  }

  /** Admin-facing school-wide analytics. */
  async reports(user: AuthPrincipal, academicYearId?: string, termId?: string) {
    const context = await this.tenant.currentContext(user.schoolId);
    const yearId = academicYearId ?? context.school.currentAcademicYearId;
    const termFilter = termId ?? context.school.currentTermId;

    const [enrolment, assessments, classProgress, teacherCoverage, timetableStats] = await Promise.all([
      this.prisma.grade.findMany({
        where: { schoolId: user.schoolId },
        orderBy: { level: 'asc' },
        include: {
          classes: {
            where: { ...(yearId ? { academicYearId: yearId } : {}), isActive: true },
            include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
          },
        },
      }),
      this.prisma.assessment.findMany({
        where: { schoolId: user.schoolId, ...(yearId ? { academicYearId: yearId } : {}), ...(termFilter ? { termId: termFilter } : {}) },
        include: {
          class: { select: { name: true } }, learningArea: { select: { name: true } }, category: { select: { name: true } },
          _count: { select: { results: true } },
        },
      }),
      this.prisma.class.findMany({
        where: { schoolId: user.schoolId, ...(yearId ? { academicYearId: yearId } : {}), isActive: true },
        include: {
          grade: { select: { name: true } },
          _count: { select: { enrollments: { where: { status: 'ACTIVE' } }, teacherAssignments: true } },
          requirements: { include: { learningArea: { select: { name: true } } } },
        },
      }),
      this.prisma.teacherProfile.findMany({
        where: { schoolId: user.schoolId, isActive: true },
        include: { user: { select: { fullName: true } }, assignments: { where: { isActive: true }, include: { class: { include: { requirements: true } } } } },
      }),
      this.prisma.timetable.findMany({
        where: { schoolId: user.schoolId, ...(yearId ? { academicYearId: yearId } : {}) },
        include: { versions: { include: { _count: { select: { conflicts: true, entries: true } } } }, term: { select: { name: true } } },
      }),
    ]);

    const assessmentStatus = { draft: 0, ready: 0, published: 0, archived: 0 };
    for (const assessment of assessments) {
      if (assessment.status === 'DRAFT') assessmentStatus.draft += 1;
      else if (assessment.status === 'READY_FOR_REVIEW') assessmentStatus.ready += 1;
      else if (assessment.status === 'PUBLISHED' || assessment.status === 'CORRECTED') assessmentStatus.published += 1;
      else assessmentStatus.archived += 1;
    }

    const completion = await Promise.all(
      assessments.map(async (assessment) => {
        const learners = await this.prisma.classEnrollment.count({ where: { classId: assessment.classId, status: 'ACTIVE' } });
        return {
          assessmentId: assessment.id, title: assessment.title, className: assessment.class.name,
          learningAreaName: assessment.learningArea.name, categoryName: assessment.category.name,
          status: assessment.status, entered: assessment._count.results, expected: learners,
          missing: Math.max(0, learners - assessment._count.results),
          completionPercent: learners === 0 ? 0 : Math.round((assessment._count.results / learners) * 100),
        };
      }),
    );

    return {
      academicContext: { academicYearName: context.academicYear?.name ?? null, termName: context.term?.name ?? null },
      enrolmentByGrade: enrolment.map((g) => ({
        gradeName: g.name,
        learners: g.classes.reduce((sum, c) => sum + c._count.enrollments, 0),
        classes: g.classes.map((c) => ({ classId: c.id, name: c.name, learners: c._count.enrollments, capacity: c.capacity })),
      })),
      assessmentStatus,
      assessmentCompletion: completion.sort((a, b) => a.completionPercent - b.completionPercent).slice(0, 30),
      classCoverage: classProgress.map((klass) => ({
        classId: klass.id, className: klass.name, gradeName: klass.grade.name,
        learners: klass._count.enrollments,
        requiredLearningAreas: klass.requirements.length,
        assignedTeachers: klass._count.teacherAssignments,
        missingTeacherAssignments: Math.max(0, klass.requirements.length - klass._count.teacherAssignments),
        gaps: klass.requirements.filter((r) => !r.learningArea).map((r) => r.learningArea.name),
      })),
      teacherWorkload: teacherCoverage.map((teacher) => {
        const periods = teacher.assignments.reduce((sum, a) => {
          const requirement = a.class.requirements.find((r) => r.learningAreaId === a.learningAreaId);
          return sum + (requirement?.periodsPerWeek ?? a.lessonsPerWeek ?? 0);
        }, 0);
        return {
          teacherId: teacher.id, teacherName: teacher.user.fullName, staffNumber: teacher.staffNumber,
          classes: teacher.assignments.length, weeklyPeriods: periods,
          maxPeriodsPerWeek: teacher.maxPeriodsPerWeek, overLimit: !!teacher.maxPeriodsPerWeek && periods > teacher.maxPeriodsPerWeek,
        };
      }).sort((a, b) => b.weeklyPeriods - a.weeklyPeriods),
      timetableCoverage: timetableStats.map((t) => ({
        timetableId: t.id, name: t.name, termName: t.term.name, status: t.status,
        versions: t.versions.map((v) => ({ versionNumber: v.versionNumber, status: v.status, entries: v._count.entries, conflicts: v._count.conflicts })),
      })),
      classLearningAreaProgress: classProgress.map((klass) => ({
        className: klass.name,
        learningAreas: klass.requirements.map((r) => ({ name: r.learningArea.name, periodsPerWeek: r.periodsPerWeek })),
      })),
    };
  }
}
