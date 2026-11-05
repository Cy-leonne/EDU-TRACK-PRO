import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileVisibility } from '@prisma/client';
import { isTeacherRole } from '@edutrack/shared-config';
import { randomUUID } from 'crypto';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { validateUpload } from '../../common/storage/file-validation';
import { ResourceAccessDeniedException, TenantIsolationException } from '../../common/errors/domain-errors';
import { TenantService } from '../../common/tenancy/tenant.service';

export interface UploadOptions {
  purpose: 'ASSESSMENT' | 'SUBMISSION' | 'RESOURCE' | 'LOGO' | 'IMPORT' | 'GENERAL';
  visibility?: FileVisibility;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantService,
    private readonly config: ConfigService,
  ) {}

  async upload(
    user: AuthPrincipal,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    options: UploadOptions,
  ) {
    const maxBytes = (this.config.get<number>('storage.maxUploadMb') ?? 15) * 1024 * 1024;
    // Throws a descriptive 400 when the content does not match an allowed type.
    const validated = validateUpload(file, maxBytes);

    const key = this.storage.buildObjectKey({
      schoolId: user.schoolId,
      purpose: options.purpose,
      extension: validated.extension,
    });
    const stored = await this.storage.put(key, file.buffer, validated.detectedMime);

    const record = await this.prisma.fileObject.create({
      data: {
        schoolId: user.schoolId,
        ownerUserId: user.userId,
        storageDriver: stored.driver,
        bucket: stored.bucket,
        objectKey: stored.objectKey,
        originalName: validated.sanitizedName,
        mimeType: validated.detectedMime,
        detectedMime: validated.detectedMime,
        sizeBytes: validated.sizeBytes,
        checksumSha256: stored.checksumSha256,
        visibility: options.visibility ?? FileVisibility.PRIVATE,
        purpose: options.purpose,
        metadata: { claimedMime: validated.claimedMime, kind: validated.kindLabel },
      },
    });

    return {
      id: record.id,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      purpose: record.purpose,
      createdAt: record.createdAt.toISOString(),
      downloadUrl: `/api/v1/files/${record.id}/download`,
      checksumSha256: record.checksumSha256,
    };
  }

  /**
   * Authorises a download. Never returns the object key to the client, and
   * never exposes a permanent public URL.
   */
  async authorizeDownload(user: AuthPrincipal, fileId: string): Promise<{
    key: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    signedUrl: string | null;
  }> {
    const file = await this.prisma.fileObject.findFirst({
      where: { id: fileId, deletedAt: null },
      include: {
        assessmentLinks: { include: { assessment: { select: { id: true, schoolId: true, classId: true, status: true, learningAreaId: true, createdById: true } } } },
        resources: { select: { id: true, schoolId: true, classId: true, visibleToParents: true, publishedAt: true, createdById: true, learningAreaId: true } },
        submissions: {
          select: {
            id: true,
            learnerId: true,
            submittedById: true,
            assignment: { select: { id: true, classId: true, learningAreaId: true, createdById: true } },
          },
        },
      },
    });
    if (!file || file.schoolId !== user.schoolId) throw new TenantIsolationException('File');

    const allowed = await this.canRead(user, file);
    if (!allowed) throw new ResourceAccessDeniedException('You do not have access to this document.');

    const ttl = this.config.get<number>('storage.signedUrlTtlSeconds') ?? 300;
    const signedUrl = await this.storage.signedUrl(file.objectKey, ttl);
    return { key: file.objectKey, fileName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, signedUrl };
  }

  async streamFor(user: AuthPrincipal, fileId: string) {
    const info = await this.authorizeDownload(user, fileId);
    const stream = await this.storage.getStream(info.key);
    return { ...info, stream };
  }

  private async canRead(
    user: AuthPrincipal,
    file: {
      purpose: string;
      ownerUserId: string | null;
      schoolId: string;
      assessmentLinks: { assessment: { id: string; schoolId: string; classId: string; status: string; createdById: string } }[];
      resources: { id: string; schoolId: string; classId: string; visibleToParents: boolean; publishedAt: Date | null; createdById: string }[];
      submissions: { id: string; learnerId: string; submittedById: string; assignment: { id: string; classId: string; learningAreaId: string; createdById: string } }[];
    },
  ): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    if (file.purpose === 'LOGO') return true; // school branding is visible to signed-in members
    if (file.purpose === 'IMPORT') return false; // import files are admin-only

    if (isTeacherRole(user.role)) {
      if (file.ownerUserId === user.userId) return true;
      const profileId = await this.tenant.teacherProfileId(user);
      for (const link of file.assessmentLinks) {
        const ok = await this.prisma.teacherAssignment.findFirst({
          where: { teacherId: profileId, classId: link.assessment.classId, isActive: true },
          select: { id: true },
        });
        if (ok) return true;
        const isClassTeacher = await this.prisma.class.findFirst({ where: { id: link.assessment.classId, classTeacherId: profileId }, select: { id: true } });
        if (isClassTeacher) return true;
      }
      for (const resource of file.resources) {
        const ok = await this.prisma.teacherAssignment.findFirst({
          where: { teacherId: profileId, classId: resource.classId, isActive: true },
          select: { id: true },
        });
        if (ok) return true;
      }
      for (const submission of file.submissions) {
        // Learners have no accounts: the teacher who set the work, or any teacher of
        // that class, reviews the uploaded work.
        if (submission.assignment.createdById === user.userId) return true;
        const ok = await this.prisma.teacherAssignment.findFirst({
          where: { teacherId: profileId, classId: submission.assignment.classId, isActive: true },
          select: { id: true },
        });
        if (ok) return true;
      }
      return false;
    }

    // PARENT: only documents attached to their linked learner's class, and only
    // once the assessment/resource has been published.
    const parentId = await this.tenant.parentProfileId(user);
    const links = await this.prisma.parentLearnerLink.findMany({
      where: { parentProfileId: parentId, revokedAt: null, isVerified: true },
      select: { learnerId: true, canViewResults: true, canViewResources: true },
    });
    if (!links.length) return false;
    const learnerIds = links.map((l) => l.learnerId);

    for (const link of file.assessmentLinks) {
      if (!['PUBLISHED', 'CORRECTED'].includes(link.assessment.status)) continue;
      const enrolled = await this.prisma.classEnrollment.findFirst({
        where: { classId: link.assessment.classId, learnerId: { in: learnerIds }, status: 'ACTIVE' },
        select: { id: true },
      });
      if (enrolled) return true;
    }
    for (const resource of file.resources) {
      if (!resource.publishedAt || !resource.visibleToParents) continue;
      const enrolled = await this.prisma.classEnrollment.findFirst({
        where: { classId: resource.classId, learnerId: { in: learnerIds }, status: 'ACTIVE' },
        select: { id: true },
      });
      if (enrolled) return true;
    }

    // Hand-in files: the guardian who uploaded the work can always retrieve it again
    // (to check what was sent, or to re-upload), and a guardian can read the hand-in
    // of a learner they are verified for — but only when the link carries the
    // resources permission.
    const canSeeResources = links.some((link) => link.canViewResources);
    for (const submission of file.submissions) {
      if (submission.submittedById === user.userId) return true;
      if (canSeeResources && learnerIds.includes(submission.learnerId)) return true;
    }
    return false;
  }

  async remove(user: AuthPrincipal, fileId: string): Promise<void> {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, schoolId: user.schoolId } });
    if (!file) throw new NotFoundException('File not found');
    if (user.role !== 'ADMIN' && file.ownerUserId !== user.userId) {
      throw new ResourceAccessDeniedException('You can only remove files you uploaded.');
    }
    // Archived learning resources no longer count as a live reference: the row
    // keeps its fileId for the audit trail, but the admin must be able to free
    // the storage afterwards.
    const linked = await this.prisma.$transaction([
      this.prisma.assessmentResource.count({ where: { fileId } }),
      this.prisma.learningResource.count({ where: { fileId, archivedAt: null } }),
    ]);
    if (linked.some((count) => count > 0)) {
      throw new BadRequestException('This file is attached to an assessment or resource. Remove it there first.');
    }
    await this.prisma.fileObject.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await this.storage.delete(file.objectKey);
  }

  /** Metadata only - no bytes. */
  async describe(fileId: string, schoolId: string) {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, schoolId, deletedAt: null } });
    if (!file) return null;
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      downloadUrl: `/api/v1/files/${file.id}/download`,
    };
  }

  /** Used by tests to verify stored objects without hitting the network. */
  async assertStoredObjectExists(fileId: string): Promise<boolean> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) return false;
    try {
      const buffer = await this.storage.getBody(file.objectKey);
      return buffer.length > 0;
    } catch {
      return false;
    }
  }

  static newUploadToken(): string {
    return randomUUID();
  }
}
