import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { isTeacherRole } from '@edutrack/shared-config';
import type { amendResultSchema, bulkResultEntrySchema, feedbackSchema, resultEntrySchema } from '@edutrack/validation';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessRuleException, ResourceAccessDeniedException, TenantIsolationException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { AssessmentsService } from './assessments.service';
import { NotificationType } from '@prisma/client';

type ResultEntry = z.infer<typeof resultEntrySchema>;
type BulkInput = z.infer<typeof bulkResultEntrySchema>;
type AmendInput = z.infer<typeof amendResultSchema>;
type FeedbackInput = z.infer<typeof feedbackSchema>;

/**
 * Result entry, validation, publication and amendment.
 *
 * Validation rules enforced here (not only in the UI):
 *  * numerical scores must be within 0..totalMarks of the assessment;
 *  * achievement level must belong to the school's own configured bands;
 *  * rubric scores must reference criteria of the assessment's rubric;
 *  * only results of actively enrolled learners can be recorded;
 *  * published results cannot be edited - they are amended with a reason,
 *    which writes an immutable ResultChangeLog entry.
 */
/** One plotted point on a learner-progress chart: never an official national grade. */
export interface ProgressPoint {
  label: string;
  percent: number | null;
  achievement: string | null;
  date: string;
}

@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly assessments: AssessmentsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The results grid: every active learner in the class, plus any saved result. */
  async grid(user: AuthPrincipal, assessmentId: string) {
    const assessment = await this.loadAssessment(user, assessmentId);
    const [learners, results, levels] = await Promise.all([
      this.prisma.classEnrollment.findMany({
        where: { classId: assessment.classId, status: 'ACTIVE' },
        orderBy: [{ learner: { lastName: 'asc' } }, { learner: { firstName: 'asc' } }],
        include: { learner: true },
      }),
      this.prisma.assessmentResult.findMany({
        where: { assessmentId },
        include: {
          rubricScores: true,
          feedback: { include: { author: { select: { fullName: true } } } },
          achievementLevel: true,
          enteredBy: { select: { fullName: true } },
        },
      }),
      this.prisma.achievementLevel.findMany({ where: { schoolId: user.schoolId, isActive: true }, orderBy: { order: 'asc' } }),
    ]);

    const rubric = assessment.rubricId
      ? await this.prisma.rubric.findUnique({
          where: { id: assessment.rubricId },
          include: { criteria: { orderBy: { order: 'asc' }, include: { levels: { orderBy: { order: 'asc' } } } } },
        })
      : null;

    const totalMarks = assessment.totalMarks ? Number(assessment.totalMarks) : null;

    return {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        className: assessment.class.name,
        learningAreaName: assessment.learningArea.name,
        totalMarks,
        usesMarks: assessment.usesMarks,
        usesRubric: assessment.usesRubric,
        status: assessment.status,
        assessmentDate: assessment.assessmentDate.toISOString().slice(0, 10),
      },
      achievementLevels: levels.map((l) => ({ id: l.id, code: l.code, label: l.label, minPercent: Number(l.minPercent), maxPercent: Number(l.maxPercent), description: l.description })),
      rubric: rubric
        ? {
            id: rubric.id,
            title: rubric.title,
            criteria: rubric.criteria.map((c) => ({
              id: c.id, title: c.title, description: c.description,
              maxScore: c.maxScore ? Number(c.maxScore) : null, weight: c.weight ? Number(c.weight) : null,
              levels: c.levels.map((l) => ({ id: l.id, label: l.label, score: Number(l.score), description: l.description })),
            })),
          }
        : null,
      rows: learners.map((enrollment) => {
        const result = results.find((r) => r.learnerId === enrollment.learnerId);
        const score = result?.numericScore ? Number(result.numericScore) : null;
        return {
          learnerId: enrollment.learnerId,
          learnerName: `${enrollment.learner.firstName} ${enrollment.learner.lastName}`,
          admissionNumber: enrollment.learner.admissionNumber,
          assessmentNumber: enrollment.learner.assessmentNumber,
          resultId: result?.id ?? null,
          numericScore: score,
          percent: score != null && totalMarks ? Math.round((score / totalMarks) * 1000) / 10 : null,
          achievementLevelId: result?.achievementLevelId ?? null,
          achievementLevel: result?.achievementLevel ? { id: result.achievementLevel.id, code: result.achievementLevel.code, label: result.achievementLevel.label } : null,
          isAbsent: result?.isAbsent ?? false,
          isExcused: result?.isExcused ?? false,
          status: result?.status ?? 'NOT_ENTERED',
          comment: result?.comment ?? null,
          enteredBy: result?.enteredBy?.fullName ?? null,
          updatedAt: result?.updatedAt?.toISOString() ?? null,
          rubricScores: result?.rubricScores.map((s) => ({ criterionId: s.criterionId, levelId: s.levelId, score: s.score ? Number(s.score) : null, comment: s.comment })) ?? [],
          feedback: result?.feedback.map((f) => ({ id: f.id, narrative: f.narrative, authorName: f.author.fullName, isPublished: f.isPublished, createdAt: f.createdAt.toISOString() })) ?? [],
        };
      }),
      summary: {
        expected: learners.length,
        entered: results.length,
        missing: Math.max(0, learners.length - results.length),
        absent: results.filter((r) => r.isAbsent).length,
        averagePercent:
          totalMarks && results.length
            ? Math.round((results.reduce((sum, r) => sum + (r.numericScore ? Number(r.numericScore) : 0), 0) / (results.length * totalMarks)) * 1000) / 10
            : null,
      },
    };
  }

  private async loadAssessment(user: AuthPrincipal, assessmentId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId: user.schoolId },
      include: { class: { select: { id: true, name: true } }, learningArea: { select: { id: true, name: true } } },
    });
    if (!assessment) throw new TenantIsolationException('Assessment');
    if (user.role === 'PARENT') throw new ResourceAccessDeniedException('Parents cannot open the teacher results grid.');
    if (isTeacherRole(user.role)) {
      await this.tenant.assertTeacherClassAssignment(user, assessment.classId, assessment.learningAreaId);
    }
    return assessment;
  }

  /* ------------------------------ entry --------------------------------- */

  private async validateEntries(
    assessment: { id: string; classId: string; schoolId: string; totalMarks: Prisma.Decimal | null; usesMarks: boolean; usesRubric: boolean; rubricId: string | null; status: string },
    entries: ResultEntry[],
  ) {
    const learnerIds = entries.map((e) => e.learnerId);
    const enrolled = await this.prisma.classEnrollment.findMany({
      where: { classId: assessment.classId, status: 'ACTIVE', learnerId: { in: learnerIds } },
      select: { learnerId: true },
    });
    const enrolledSet = new Set(enrolled.map((e) => e.learnerId));
    const totalMarks = assessment.totalMarks ? Number(assessment.totalMarks) : null;
    const errors: { learnerId: string; field: string; message: string }[] = [];

    const levelIds = new Set(
      entries.filter((e) => e.achievementLevelId).map((e) => e.achievementLevelId as string),
    );
    if (levelIds.size) {
      const validLevels = await this.prisma.achievementLevel.findMany({
        where: { schoolId: assessment.schoolId, id: { in: [...levelIds] } },
        select: { id: true },
      });
      const validSet = new Set(validLevels.map((l) => l.id));
      for (const id of levelIds) if (!validSet.has(id)) errors.push({ learnerId: '', field: 'achievementLevelId', message: 'Unknown achievement level for this school.' });
    }

    let validCriteria = new Set<string>();
    if (assessment.rubricId) {
      const criteria = await this.prisma.rubricCriterion.findMany({ where: { rubricId: assessment.rubricId }, select: { id: true } });
      validCriteria = new Set(criteria.map((c) => c.id));
    }

    for (const entry of entries) {
      if (!enrolledSet.has(entry.learnerId)) {
        errors.push({ learnerId: entry.learnerId, field: 'learnerId', message: 'This learner is not actively enrolled in the assessment class.' });
      }
      if (assessment.usesMarks && !entry.isAbsent && !entry.isExcused) {
        if (entry.numericScore === undefined || entry.numericScore === null) {
          errors.push({ learnerId: entry.learnerId, field: 'numericScore', message: 'Enter a mark, or mark the learner as absent/excused.' });
        } else if (entry.numericScore < 0) {
          errors.push({ learnerId: entry.learnerId, field: 'numericScore', message: 'A mark cannot be negative.' });
        } else if (totalMarks != null && entry.numericScore > totalMarks) {
          errors.push({ learnerId: entry.learnerId, field: 'numericScore', message: `Mark exceeds the assessment maximum of ${totalMarks}.` });
        }
      }
      if (assessment.usesRubric && entry.rubricScores?.length) {
        for (const score of entry.rubricScores) {
          if (!validCriteria.has(score.criterionId)) {
            errors.push({ learnerId: entry.learnerId, field: 'rubricScores', message: 'Rubric score references a criterion outside this assessment’s rubric.' });
          }
        }
      }
      if (assessment.usesRubric && (!entry.rubricScores || entry.rubricScores.length === 0) && !entry.isAbsent && !entry.isExcused && validCriteria.size > 0) {
        // Rubric-based assessment expects at least one criterion score.
        errors.push({ learnerId: entry.learnerId, field: 'rubricScores', message: 'Record at least one rubric criterion score.' });
      }
    }
    return errors;
  }

  async saveGrid(user: AuthPrincipal, assessmentId: string, input: BulkInput) {
    const assessment = await this.loadAssessment(user, assessmentId);
    if (assessment.status === 'ARCHIVED') throw new BusinessRuleException('This assessment is archived and cannot be edited.');
    if (assessment.status === 'PUBLISHED' || assessment.status === 'CORRECTED') {
      throw new BusinessRuleException('Published results are read-only. Use the amend endpoint so the correction is audited.');
    }

    const errors = await this.validateEntries(assessment, input.results);
    if (errors.length) {
      throw new BadRequestException({ message: errors.slice(0, 10).map((e) => e.message), details: errors });
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      let changed = 0;
      for (const entry of input.results) {
        const percent =
          entry.numericScore != null && assessment.totalMarks
            ? Math.round((entry.numericScore / Number(assessment.totalMarks)) * 1000) / 10
            : null;
        const achievementLevelId =
          entry.achievementLevelId ?? (percent != null ? await this.assessments.resolveAchievementLevel(assessment.schoolId, percent) : null);

        const existing = await tx.assessmentResult.findUnique({
          where: { assessmentId_learnerId: { assessmentId, learnerId: entry.learnerId } },
          include: { rubricScores: true },
        });

        const data = {
          numericScore: entry.numericScore ?? null,
          achievementLevelId,
          isAbsent: !!entry.isAbsent,
          isExcused: !!entry.isExcused,
          comment: entry.comment ?? null,
          status: (input.saveAsDraft ? 'DRAFT' : 'SUBMITTED') as 'DRAFT' | 'SUBMITTED',
          enteredById: user.userId,
        };

        if (existing) {
          if (existing.status === 'PUBLISHED' || existing.status === 'AMENDED') {
            throw new BusinessRuleException('One or more results are already published and cannot be overwritten in the draft grid.');
          }
          await tx.assessmentResult.update({ where: { id: existing.id }, data });
          if (entry.rubricScores) {
            await tx.resultRubricScore.deleteMany({ where: { resultId: existing.id } });
            if (entry.rubricScores.length) {
              await tx.resultRubricScore.createMany({
                data: entry.rubricScores.map((s) => ({ resultId: existing.id, criterionId: s.criterionId, levelId: s.levelId ?? null, score: s.score ?? null, comment: s.comment ?? null })),
              });
            }
          }
        } else {
          const result = await tx.assessmentResult.create({
            data: { schoolId: assessment.schoolId, assessmentId, learnerId: entry.learnerId, ...data },
          });
          if (entry.rubricScores?.length) {
            await tx.resultRubricScore.createMany({
              data: entry.rubricScores.map((s) => ({ resultId: result.id, criterionId: s.criterionId, levelId: s.levelId ?? null, score: s.score ?? null, comment: s.comment ?? null })),
            });
          }
        }
        changed += 1;
      }
      return changed;
    });

    await this.audit.record({
      schoolId: assessment.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: 'result.saved', entityType: 'Assessment', entityId: assessmentId,
      summary: `${saved} result(s) saved as ${input.saveAsDraft ? 'draft' : 'submitted'}`,
    });
    return { saved, draft: input.saveAsDraft };
  }

  /* ----------------------------- feedback ------------------------------- */

  async addFeedback(user: AuthPrincipal, input: FeedbackInput) {
    const result = await this.prisma.assessmentResult.findFirst({
      where: { id: input.resultId, schoolId: user.schoolId },
      include: { assessment: { select: { id: true, classId: true, learningAreaId: true, status: true, schoolId: true, title: true } } },
    });
    if (!result) throw new TenantIsolationException('Result');
    if (isTeacherRole(user.role)) await this.tenant.assertTeacherClassAssignment(user, result.assessment.classId, result.assessment.learningAreaId);

    const feedback = await this.prisma.resultFeedback.create({
      data: {
        resultId: input.resultId, authorId: user.userId, narrative: input.narrative,
        isPublished: input.isPublished && result.assessment.status !== 'DRAFT',
      },
    });
    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, action: 'result.feedback.added',
      entityType: 'AssessmentResult', entityId: input.resultId, summary: `Narrative feedback added (${input.narrative.length} chars)`,
    });
    return feedback;
  }

  /* ------------------------- amend a published result ------------------- */

  /**
   * Corrections after publication are performed through this method only.
   * The previous value, the new value, the actor, the timestamp and the reason
   * are all written to ResultChangeLog (immutable), and guardians are notified.
   */
  async amend(user: AuthPrincipal, resultId: string, input: AmendInput) {
    const result = await this.prisma.assessmentResult.findFirst({
      where: { id: resultId, schoolId: user.schoolId },
      include: { assessment: { include: { class: true, learningArea: true } } },
    });
    if (!result) throw new TenantIsolationException('Result');
    if (isTeacherRole(user.role)) await this.tenant.assertTeacherClassAssignment(user, result.assessment.classId, result.assessment.learningAreaId);
    if (!['PUBLISHED', 'AMENDED'].includes(result.status)) {
      throw new BusinessRuleException('Only published results are amended. Edit drafts in the results grid instead.');
    }
    const totalMarks = result.assessment.totalMarks ? Number(result.assessment.totalMarks) : null;
    if (input.numericScore != null && totalMarks != null && input.numericScore > totalMarks) {
      throw new BusinessRuleException(`Mark exceeds the assessment maximum of ${totalMarks}.`);
    }

    const before = {
      numericScore: result.numericScore ? Number(result.numericScore) : null,
      achievementLevelId: result.achievementLevelId,
      comment: result.comment,
      isAbsent: result.isAbsent,
      isExcused: result.isExcused,
    };
    const percent = input.numericScore != null && totalMarks ? Math.round((input.numericScore / totalMarks) * 1000) / 10 : null;
    const achievementLevelId = input.achievementLevelId ?? (percent != null ? await this.assessments.resolveAchievementLevel(user.schoolId, percent) : before.achievementLevelId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.assessmentResult.update({
        where: { id: resultId },
        data: {
          numericScore: input.numericScore ?? null,
          achievementLevelId,
          comment: input.comment ?? null,
          status: 'AMENDED',
          amendedAt: new Date(),
        },
      });
      await tx.resultChangeLog.create({
        data: {
          resultId, actorId: user.userId, action: 'AMEND', reason: input.reason,
          beforeJson: before as never, afterJson: { numericScore: input.numericScore ?? null, achievementLevelId, comment: input.comment ?? null } as never,
        },
      });
      await tx.assessmentChangeLog.create({
        data: {
          assessmentId: result.assessmentId, actorId: user.userId, action: 'CORRECT', reason: input.reason,
          summary: 'A published result was amended',
        },
      });
      return next;
    });

    await this.audit.record({
      schoolId: user.schoolId, actorUserId: user.userId, actorRole: user.role,
      action: 'result.amended', entityType: 'AssessmentResult', entityId: resultId,
      summary: `${result.assessment.title} — correction applied`, before, after: { numericScore: input.numericScore ?? null, reason: input.reason },
    });

    if (input.notifyParents) {
      const links = await this.prisma.parentLearnerLink.findMany({
        where: { learnerId: result.learnerId, isVerified: true, revokedAt: null, canViewResults: true },
        include: { parentProfile: { include: { user: { select: { id: true } } } } },
      });
      await this.notifications.notify({
        schoolId: user.schoolId,
        userIds: links.map((l) => l.parentProfile.user.id),
        type: NotificationType.ASSESSMENT_PUBLISHED,
        title: 'A published result was corrected',
        body: `A result for "${result.assessment.title}" (${result.assessment.learningArea.name}) was corrected by the school. Open the portal to see the updated record.`,
        link: '/parent/results',
        entityType: 'AssessmentResult',
        entityId: resultId,
      });
    }
    return updated;
  }

  /** Immutable change history for one result. */
  async changeHistory(user: AuthPrincipal, resultId: string) {
    const result = await this.prisma.assessmentResult.findFirst({
      where: { id: resultId, schoolId: user.schoolId },
      include: { assessment: { select: { classId: true, learningAreaId: true, title: true } }, learner: { select: { firstName: true, lastName: true } } },
    });
    if (!result) throw new TenantIsolationException('Result');
    if (isTeacherRole(user.role)) await this.tenant.assertTeacherClassAssignment(user, result.assessment.classId, result.assessment.learningAreaId);
    if (user.role === 'PARENT') {
      await this.tenant.assertLearnerAccess(user, result.learnerId);
      // Parents only see that a correction happened, not staff details of the change.
      const history = await this.prisma.resultChangeLog.findMany({ where: { resultId }, orderBy: { createdAt: 'desc' } });
      return history.map((h) => ({ action: h.action, reason: h.reason, createdAt: h.createdAt }));
    }
    const history = await this.prisma.resultChangeLog.findMany({
      where: { resultId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { fullName: true, email: true } } },
    });
    return history.map((h) => ({
      id: h.id, action: h.action, reason: h.reason, before: h.beforeJson, after: h.afterJson,
      actorName: h.actor.fullName, actorEmail: h.actor.email, createdAt: h.createdAt,
    }));
  }

  /* ------------------------- learner-facing reads ------------------------ */

  /** Published results for one learner. Parents: only their own linked learner. */
  async learnerResults(user: AuthPrincipal, learnerId: string, filters: { termId?: string; learningAreaId?: string } = {}) {
    await this.tenant.assertLearnerAccess(user, learnerId);

    if (user.role === 'PARENT') {
      const parentId = await this.tenant.parentProfileId(user);
      const link = await this.prisma.parentLearnerLink.findFirst({
        where: { parentProfileId: parentId, learnerId, isVerified: true, revokedAt: null },
        select: { canViewResults: true },
      });
      if (!link?.canViewResults) throw new ResourceAccessDeniedException('Result access for this learner has not been enabled.');
    }

    const results = await this.prisma.assessmentResult.findMany({
      where: {
        learnerId,
        schoolId: user.schoolId,
        // Parents see published results only. Staff see everything.
        ...(user.role === 'PARENT' ? { status: { in: ['PUBLISHED', 'AMENDED'] } } : {}),
        ...(filters.termId ? { assessment: { termId: filters.termId } } : {}),
        ...(filters.learningAreaId ? { assessment: { learningAreaId: filters.learningAreaId } } : {}),
      },
      orderBy: { assessment: { assessmentDate: 'desc' } },
      include: {
        achievementLevel: true,
        assessment: {
          include: {
            learningArea: { select: { id: true, name: true, colorHex: true } },
            category: { select: { name: true, code: true } },
            term: { select: { id: true, name: true } },
            class: { select: { name: true } },
          },
        },
        feedback: { where: { isPublished: true }, include: { author: { select: { fullName: true } } } },
        rubricScores: true,
        changeLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const totalMarksOf = (r: (typeof results)[number]) => (r.assessment.totalMarks ? Number(r.assessment.totalMarks) : null);

    return {
      learnerId,
      results: results.map((r) => {
        const score = r.numericScore ? Number(r.numericScore) : null;
        const total = totalMarksOf(r);
        return {
          id: r.id,
          assessmentId: r.assessmentId,
          assessmentTitle: r.assessment.title,
          learningAreaId: r.assessment.learningArea.id,
          learningAreaName: r.assessment.learningArea.name,
          learningAreaColor: r.assessment.learningArea.colorHex,
          categoryName: r.assessment.category.name,
          termName: r.assessment.term.name,
          className: r.assessment.class.name,
          assessmentDate: r.assessment.assessmentDate.toISOString().slice(0, 10),
          numericScore: score,
          totalMarks: total,
          percent: score != null && total ? Math.round((score / total) * 1000) / 10 : null,
          achievementLevel: r.achievementLevel ? { code: r.achievementLevel.code, label: r.achievementLevel.label, description: r.achievementLevel.description } : null,
          isAbsent: r.isAbsent,
          isExcused: r.isExcused,
          status: r.status,
          comment: r.comment,
          publishedAt: r.publishedAt?.toISOString() ?? null,
          amendedAt: r.amendedAt?.toISOString() ?? null,
          wasCorrected: r.status === 'AMENDED' || r.changeLogs.some((c) => c.action === 'AMEND'),
          feedback: r.feedback.map((f) => ({ narrative: f.narrative, authorName: f.author.fullName, createdAt: f.createdAt.toISOString() })),
          rubricScores: r.rubricScores.map((s) => ({ criterionId: s.criterionId, levelId: s.levelId, score: s.score ? Number(s.score) : null, comment: s.comment })),
          // Explicitly labelled: school-defined achievement band, not a national outcome.
          reportingBasis: 'SCHOOL_DEFINED_ACHIEVEMENT_BAND',
        };
      }),
    };
  }

  /** Progress summary per learning area, used by parent + teacher dashboards. */
  async learnerProgress(user: AuthPrincipal, learnerId: string, termId?: string) {
    await this.tenant.assertLearnerAccess(user, learnerId);
    const results = await this.prisma.assessmentResult.findMany({
      where: {
        learnerId, schoolId: user.schoolId,
        ...(user.role === 'PARENT' ? { status: { in: ['PUBLISHED', 'AMENDED'] } } : {}),
        ...(termId ? { assessment: { termId } } : {}),
      },
      include: {
        achievementLevel: true,
        assessment: { include: { learningArea: { select: { id: true, name: true, colorHex: true } }, category: { select: { name: true } } } },
      },
      orderBy: { assessment: { assessmentDate: 'asc' } },
    });

    const byArea = new Map<string, { learningAreaName: string; color: string; points: ProgressPoint[] }>();
    for (const result of results) {
      const area = result.assessment.learningArea;
      const entry = byArea.get(area.id) ?? { learningAreaName: area.name, color: area.colorHex, points: [] as ProgressPoint[] };
      const total = result.assessment.totalMarks ? Number(result.assessment.totalMarks) : null;
      const score = result.numericScore ? Number(result.numericScore) : null;
      entry.points.push({
        label: result.assessment.title,
        percent: score != null && total ? Math.round((score / total) * 1000) / 10 : null,
        achievement: result.achievementLevel?.label ?? null,
        date: result.assessment.assessmentDate.toISOString().slice(0, 10),
      });
      byArea.set(area.id, entry);
    }

    return [...byArea.entries()].map(([learningAreaId, entry]) => {
      const percents = entry.points.map((p) => p.percent).filter((p): p is number => p != null);
      const average = percents.length ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10 : null;
      let trend: 'UP' | 'DOWN' | 'STEADY' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';
      if (percents.length >= 2) {
        const first = percents[0] as number;
        const last = percents[percents.length - 1] as number;
        trend = last - first > 3 ? 'UP' : first - last > 3 ? 'DOWN' : 'STEADY';
      }
      return {
        learningAreaId,
        learningAreaName: entry.learningAreaName,
        colorHex: entry.color,
        points: entry.points,
        averagePercent: average,
        latestAchievement: entry.points[entry.points.length - 1]?.achievement ?? null,
        trend,
        basis: 'SCHOOL_DEFINED_ACHIEVEMENT_BAND' as const,
      };
    });
  }
}
