import { Injectable } from '@nestjs/common';
import { NotificationType, SubmissionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { BusinessRuleException, ResourceAccessDeniedException, TenantIsolationException } from '../../common/errors/domain-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenancy/tenant.service';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import type { z } from 'zod';
import { isTeacherRole } from '@edutrack/shared-config';
import type { submissionCreateSchema, submissionQuerySchema, submissionReviewSchema } from '@edutrack/validation';

type CreateInput = z.infer<typeof submissionCreateSchema>;
type ReviewInput = z.infer<typeof submissionReviewSchema>;
type QueryInput = z.infer<typeof submissionQuerySchema>;

/**
 * Assignment submissions.
 *
 * Design note (why this shape): EduTrack Pro has exactly three login roles, and
 * learners are records rather than users. So work is always handed in by a signed
 * in adult:
 *   * PARENT  - a guardian submits on behalf of a verified, linked learner.
 *   * TEACHER - records work handed in on paper or by another channel.
 *   * ADMIN   - can do either for support/backfill.
 * `submittedById` + `submitterRole` make the proxy relationship auditable, and
 * every write below is checked against the assignment's class, the learner's
 * enrolment, and the caller's relationship to that learner.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------- helpers ------------------------------ */

  /** Loads an assignment that the caller is allowed to see at all. */
  private async loadAssignment(user: AuthPrincipal, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, schoolId: user.schoolId, archivedAt: null },
      include: {
        class: { select: { id: true, name: true } },
        learningArea: { select: { id: true, name: true, colorHex: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!assignment) throw new TenantIsolationException('Assignment');
    return assignment;
  }

  /** Enrolment is what makes a learner "in" the assignment's class. */
  private async assertLearnerEnrolled(learnerId: string, classId: string) {
    const enrollment = await this.prisma.classEnrollment.findFirst({
      where: { learnerId, classId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!enrollment) {
      throw new BusinessRuleException('That learner is not enrolled in the class this assignment was set for.');
    }
  }

  /**
   * Authorises who may act for a given learner, then returns the learner row.
   *
   * Delegates to the shared tenancy guard so the rules stay in one place:
   *  * PARENT  - must hold a verified, non-revoked link (403 otherwise), and the
   *              link must still allow resource access.
   *  * TEACHER - learner must be in a class they teach or are class teacher of.
   *  * ADMIN   - school-wide.
   */
  private async assertCanActForLearner(user: AuthPrincipal, learnerId: string) {
    const access = await this.tenant.assertLearnerAccess(user, learnerId);

    if (user.role === 'PARENT') {
      const parentId = await this.tenant.parentProfileId(user);
      const link = await this.prisma.parentLearnerLink.findFirst({
        where: { parentProfileId: parentId, learnerId, revokedAt: null, isVerified: true },
        select: { canViewResources: true },
      });
      if (link && !link.canViewResources) {
        throw new ResourceAccessDeniedException('Your access to this learner’s learning materials has been limited by the school.');
      }
    }

    const learner = await this.prisma.learner.findFirst({
      where: { id: access.id },
      select: { id: true, firstName: true, lastName: true, currentClassId: true, status: true, archivedAt: true },
    });
    if (!learner || learner.archivedAt) throw new TenantIsolationException('Learner');
    return learner;
  }

  /** Guardian user ids for a learner (used to notify the right adults). */
  private async guardianUserIds(learnerId: string): Promise<string[]> {
    const links = await this.prisma.parentLearnerLink.findMany({
      where: { learnerId, revokedAt: null, isVerified: true },
      select: { parentProfile: { select: { userId: true } } },
    });
    return links.map((l) => l.parentProfile.userId).filter(Boolean);
  }

  /* ------------------------------ read side ----------------------------- */

  async list(user: AuthPrincipal, query: QueryInput) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Number(query.pageSize) || 25);

    const where: Record<string, unknown> = {
      schoolId: user.schoolId,
      withdrawnAt: null,
      ...(query.status ? { status: query.status as SubmissionStatus } : {}),
      ...(query.assignmentId ? { assignmentId: query.assignmentId } : {}),
      ...(query.learnerId ? { learnerId: query.learnerId } : {}),
      ...(query.classId ? { assignment: { classId: query.classId } } : {}),
    };

    if (user.role === 'PARENT') {
      const parentId = await this.tenant.parentProfileId(user);
      const links = await this.prisma.parentLearnerLink.findMany({
        where: { parentProfileId: parentId, revokedAt: null, isVerified: true, canViewResources: true },
        select: { learnerId: true },
      });
      // A guardian only ever sees submissions belonging to their own learners.
      where.learnerId = query.learnerId
        ? (links.some((l) => l.learnerId === query.learnerId) ? query.learnerId : '__none__')
        : { in: links.map((l) => l.learnerId) };
      if (!links.length) return { items: [], meta: { page, pageSize, total: 0 } };
    } else if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      const assignments = await this.prisma.teacherAssignment.findMany({
        where: { teacherId, isActive: true },
        select: { classId: true },
      });
      where.OR = [
        { assignment: { classId: { in: assignments.map((a) => a.classId) } } },
        { assignment: { createdById: user.userId } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.assignmentSubmission.findMany({
        where,
        orderBy: [{ submittedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignment: { select: { id: true, title: true, dueDate: true, maxScore: true, classId: true, learningArea: { select: { name: true, colorHex: true } } } },
          learner: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, currentClassId: true } },
          submittedBy: { select: { id: true, fullName: true } },
          reviewedBy: { select: { id: true, fullName: true } },
          file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
        },
      }),
      this.prisma.assignmentSubmission.count({ where }),
    ]);

    return { items: items.map(this.toDto), meta: { page, pageSize, total } };
  }

  /**
   * Completion picture for one assignment - powers the teacher's "who has not
   * handed in?" list and the class analytics panel.
   */
  async assignmentSummary(user: AuthPrincipal, assignmentId: string) {
    const assignment = await this.loadAssignment(user, assignmentId);

    if (isTeacherRole(user.role)) {
      const teacherId = await this.tenant.teacherProfileId(user);
      const teaches = await this.prisma.teacherAssignment.findFirst({
        where: { teacherId, classId: assignment.classId, isActive: true },
        select: { id: true },
      });
      if (!teaches && assignment.createdById !== user.userId) {
        throw new ResourceAccessDeniedException('You can only view submissions for classes you teach.');
      }
    }

    const learners = await this.prisma.classEnrollment.findMany({
      where: { classId: assignment.classId, status: 'ACTIVE', learner: { archivedAt: null } },
      select: { learner: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
      orderBy: { learner: { lastName: 'asc' } },
    });

    const submissions = await this.prisma.assignmentSubmission.findMany({
      where: { assignmentId, withdrawnAt: null },
      include: { reviewedBy: { select: { fullName: true } } },
    });
    const byLearner = new Map(submissions.map((s) => [s.learnerId, s]));

    const rows = learners.map(({ learner }) => {
      const submission = byLearner.get(learner.id) ?? null;
      return {
        learnerId: learner.id,
        learnerName: `${learner.firstName} ${learner.lastName}`,
        admissionNumber: learner.admissionNumber,
        status: submission ? submission.status : ('MISSING' as const),
        submittedAt: submission?.submittedAt ?? null,
        isLate: submission?.isLate ?? false,
        score: submission?.score != null ? Number(submission.score) : null,
        feedback: submission?.feedback ?? null,
        submissionId: submission?.id ?? null,
      };
    });

    const count = (status: string) => rows.filter((r) => r.status === status).length;
    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        dueDate: assignment.dueDate,
        maxScore: assignment.maxScore != null ? Number(assignment.maxScore) : null,
        className: assignment.class.name,
        learningAreaName: assignment.learningArea.name,
      },
      rows,
      completion: {
        expected: rows.length,
        handedIn: rows.length - count('MISSING'),
        missing: count('MISSING'),
        late: rows.filter((r) => r.isLate).length,
        reviewed: count('REVIEWED') + count('ACCEPTED'),
        returned: count('RETURNED'),
        completionPercent: rows.length ? Math.round(((rows.length - count('MISSING')) / rows.length) * 100) : 0,
      },
    };
  }

  async get(user: AuthPrincipal, id: string) {
    const submission = await this.prisma.assignmentSubmission.findFirst({
      where: { id, schoolId: user.schoolId, withdrawnAt: null },
      include: {
        assignment: { include: { class: { select: { id: true, name: true } }, learningArea: { select: { id: true, name: true } } } },
        learner: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
        submittedBy: { select: { id: true, fullName: true } },
        reviewedBy: { select: { id: true, fullName: true } },
        file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
      },
    });
    if (!submission) throw new TenantIsolationException('Submission');
    await this.assertCanActForLearner(user, submission.learnerId);
    return this.toDto(submission);
  }

  /* ------------------------------ write side ---------------------------- */

  async create(user: AuthPrincipal, input: CreateInput) {
    const assignment = await this.loadAssignment(user, input.assignmentId);
    if (!assignment.publishedAt) {
      throw new BusinessRuleException('This assignment has not been published yet, so work cannot be handed in.');
    }

    const learner = await this.assertCanActForLearner(user, input.learnerId);
    await this.assertLearnerEnrolled(input.learnerId, assignment.classId);

    if (input.fileId) {
      const file = await this.prisma.fileObject.findFirst({
        where: { id: input.fileId, schoolId: user.schoolId, deletedAt: null },
        select: { id: true },
      });
      if (!file) throw new TenantIsolationException('File');
    }

    const due = assignment.dueDate;
    const isLate = !!due && Date.now() > due.getTime();
    const status: SubmissionStatus = isLate ? SubmissionStatus.LATE : SubmissionStatus.SUBMITTED;

    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { assignmentId_learnerId: { assignmentId: assignment.id, learnerId: input.learnerId } },
    });

    if (existing) {
      if (existing.withdrawnAt) {
        // Re-opened after a withdrawal: treat as a fresh hand-in.
      } else if (existing.status === SubmissionStatus.ACCEPTED) {
        throw new BusinessRuleException(
          'This work has already been accepted by the teacher. Ask the teacher to return it if something needs to change.',
        );
      }
    }

    const saved = await this.prisma.assignmentSubmission.upsert({
      where: { assignmentId_learnerId: { assignmentId: assignment.id, learnerId: input.learnerId } },
      create: {
        schoolId: user.schoolId,
        assignmentId: assignment.id,
        learnerId: input.learnerId,
        submittedById: user.userId,
        submitterRole: user.role,
        status,
        isLate,
        note: input.note ?? null,
        fileId: input.fileId || null,
        linkUrl: input.linkUrl || null,
      },
      update: {
        submittedById: user.userId,
        submitterRole: user.role,
        status,
        isLate,
        submittedAt: new Date(),
        note: input.note ?? null,
        fileId: input.fileId || null,
        linkUrl: input.linkUrl || null,
        // A re-submission supersedes the previous decision.
        reviewedById: null,
        reviewedAt: null,
        score: null,
        feedback: null,
        returnedReason: null,
        withdrawnAt: null,
      },
      include: {
        assignment: { select: { id: true, title: true, classId: true } },
        learner: { select: { id: true, firstName: true, lastName: true } },
        file: { select: { id: true, originalName: true } },
        submittedBy: { select: { id: true, fullName: true } },
      },
    });

    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: existing ? 'submission.resubmitted' : 'submission.created',
      entityType: 'AssignmentSubmission',
      entityId: saved.id,
      summary: `${learner.firstName} ${learner.lastName} - "${assignment.title}"${isLate ? ' (late)' : ''}${
        user.role === 'PARENT' ? ' via guardian account' : ''
      }`,
    });

    // Tell the teacher who set the work (never the learner's other guardians' data).
    await this.notifications.notify({
      schoolId: user.schoolId,
      userIds: [assignment.createdById],
      type: NotificationType.ASSIGNMENT_SUBMITTED,
      title: `Work handed in: ${assignment.title}`,
      body: `${learner.firstName} ${learner.lastName} (${assignment.class.name})${isLate ? ' - submitted late' : ''}.`,
      link: `/teacher/submissions?assignmentId=${assignment.id}`,
      entityType: 'Assignment',
      entityId: assignment.id,
    });

    return this.toDto(saved);
  }

  async review(user: AuthPrincipal, id: string, input: ReviewInput) {
    const submission = await this.prisma.assignmentSubmission.findFirst({
      where: { id, schoolId: user.schoolId, withdrawnAt: null },
      include: {
        assignment: { select: { id: true, title: true, classId: true, learningAreaId: true, maxScore: true } },
        learner: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!submission) throw new TenantIsolationException('Submission');

    if (isTeacherRole(user.role)) {
      await this.tenant.assertTeacherClassAssignment(user, submission.assignment.classId, submission.assignment.learningAreaId);
    } else if (user.role !== 'ADMIN') {
      throw new ResourceAccessDeniedException('Only the learner’s teacher can review this work.');
    }

    const maxScore = submission.assignment.maxScore != null ? Number(submission.assignment.maxScore) : null;
    if (input.score != null && maxScore != null && input.score > maxScore) {
      throw new BusinessRuleException(`Score cannot exceed the assignment maximum of ${maxScore}.`);
    }

    const updated = await this.prisma.assignmentSubmission.update({
      where: { id },
      data: {
        status: input.status as SubmissionStatus,
        score: input.score ?? null,
        feedback: input.feedback ?? null,
        returnedReason: input.returnedReason ?? null,
        reviewedById: user.userId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'submission.reviewed',
      entityType: 'AssignmentSubmission',
      entityId: id,
      summary: `${input.status} - "${submission.assignment.title}" (${submission.learner.firstName} ${submission.learner.lastName})`,
      after: { status: input.status, score: input.score ?? null },
    });

    const guardians = await this.guardianUserIds(submission.learnerId);
    if (guardians.length) {
      const verb =
        input.status === 'ACCEPTED' ? 'accepted' : input.status === 'RETURNED' ? 'returned for rework' : 'reviewed';
      await this.notifications.notify({
        schoolId: user.schoolId,
        userIds: guardians,
        type: NotificationType.SUBMISSION_REVIEWED,
        title: `Work ${verb}: ${submission.assignment.title}`,
        body: [
          `${submission.learner.firstName}'s work for "${submission.assignment.title}" was ${verb}.`,
          input.score != null && maxScore != null ? `Score: ${input.score}/${maxScore}.` : '',
          input.feedback ? `Teacher: ${input.feedback}` : '',
          input.returnedReason ? `Needs: ${input.returnedReason}` : '',
        ]
          .filter(Boolean)
          .join(' '),
        link: '/parent/assignments',
        entityType: 'AssignmentSubmission',
        entityId: id,
        email: null,
      });
    }

    return this.toDto(updated);
  }

  /** Withdraw a hand-in before the teacher has accepted it. */
  async withdraw(user: AuthPrincipal, id: string) {
    const submission = await this.prisma.assignmentSubmission.findFirst({
      where: { id, schoolId: user.schoolId, withdrawnAt: null },
      include: { assignment: { select: { classId: true, title: true } }, learner: { select: { firstName: true, lastName: true } } },
    });
    if (!submission) throw new TenantIsolationException('Submission');

    if (user.role !== 'ADMIN' && submission.submittedById !== user.userId) {
      throw new ResourceAccessDeniedException('You can only withdraw a hand-in you recorded yourself.');
    }
    if (submission.status === SubmissionStatus.ACCEPTED) {
      throw new BusinessRuleException('Accepted work cannot be withdrawn. Ask the teacher to return it.');
    }

    await this.prisma.assignmentSubmission.update({ where: { id }, data: { withdrawnAt: new Date() } });
    await this.audit.record({
      schoolId: user.schoolId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'submission.withdrawn',
      entityType: 'AssignmentSubmission',
      entityId: id,
      summary: `Withdrawn - "${submission.assignment.title}" (${submission.learner.firstName} ${submission.learner.lastName})`,
    });
    return { withdrawn: true };
  }

  /* -------------------------------- mapping ----------------------------- */

  private toDto(submission: Record<string, any>) {
    const assignment = submission.assignment ?? {};
    const learner = submission.learner ?? {};
    return {
      id: submission.id,
      assignmentId: submission.assignmentId,
      assignmentTitle: assignment.title ?? null,
      classId: assignment.classId ?? null,
      className: assignment.class?.name ?? null,
      learningAreaName: assignment.learningArea?.name ?? null,
      learningAreaColor: assignment.learningArea?.colorHex ?? null,
      dueDate: assignment.dueDate ? new Date(assignment.dueDate).toISOString().slice(0, 10) : null,
      maxScore: assignment.maxScore != null ? Number(assignment.maxScore) : null,
      learnerId: submission.learnerId,
      learnerName: learner.firstName ? `${learner.firstName} ${learner.lastName ?? ''}`.trim() : null,
      admissionNumber: learner.admissionNumber ?? null,
      status: submission.status,
      isLate: submission.isLate,
      note: submission.note,
      linkUrl: submission.linkUrl,
      submittedAt: submission.submittedAt,
      submittedByName: submission.submittedBy?.fullName ?? null,
      submitterRole: submission.submitterRole,
      reviewedByName: submission.reviewedBy?.fullName ?? null,
      reviewedAt: submission.reviewedAt,
      score: submission.score != null ? Number(submission.score) : null,
      feedback: submission.feedback,
      returnedReason: submission.returnedReason,
      file: submission.file
        ? {
            id: submission.file.id,
            name: submission.file.originalName,
            mimeType: submission.file.mimeType,
            sizeBytes: submission.file.sizeBytes,
            downloadUrl: `/api/v1/files/${submission.file.id}/download`,
          }
        : null,
    };
  }
}
