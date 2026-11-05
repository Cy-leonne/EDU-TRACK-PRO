import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXTENSIONS, ALLOWED_UPLOAD_TYPES } from '@edutrack/shared-config';
import { CurrentUser } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { FilesService } from './files.service';

const uploadStorage = memoryStorage();

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('policy')
  @ApiOperation({ summary: 'Upload policy (allowed types, size limit) for the client-side picker' })
  policy() {
    return { maxBytes: MAX_UPLOAD_BYTES, allowedMimeTypes: ALLOWED_UPLOAD_TYPES, allowedExtensions: ALLOWED_UPLOAD_EXTENSIONS };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, purpose: { type: 'string' } } } })
  @ApiOperation({ summary: 'Upload a PDF, image or document to private storage (teachers/admins)' })
  async upload(
    @CurrentUser() user: AuthPrincipal,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    @Query('purpose') purpose = 'GENERAL',
    @Body('purpose') purposeField?: string,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded. Choose a PDF or image and try again.');
    // The query parameter wins; the multipart field is accepted too so clients that
    // build a FormData body (the web uploader, Expo) cannot silently lose the intent.
    const requested = (purpose && purpose !== 'GENERAL' ? purpose : purposeField) ?? 'GENERAL';
    const allowedPurposes = ['ASSESSMENT', 'SUBMISSION', 'RESOURCE', 'LOGO', 'IMPORT', 'GENERAL'] as const;
    const normalized = (String(requested).toUpperCase() as (typeof allowedPurposes)[number]);
    if (!allowedPurposes.includes(normalized)) throw new BadRequestException('Unsupported upload purpose.');
    return this.files.upload(user, file, { purpose: normalized });
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Authorised download. Streams the file, or redirects to a short-lived signed URL on S3.' })
  async download(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Res() res: Response) {
    const result = await this.files.streamFor(user, id);
    if (result.signedUrl) {
      // S3 driver: hand back a short-lived signed URL instead of proxying bytes.
      res.setHeader('Cache-Control', 'private, no-store');
      return res.redirect(302, result.signedUrl);
    }
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', String(result.sizeBytes));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // inline for images/PDF so the browser can preview safely, attachment otherwise
    const disposition = /^(image\/|application\/pdf)/.test(result.mimeType) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(result.fileName)}"`);
    result.stream.pipe(res);
  }

  @Get(':id/meta')
  @ApiOperation({ summary: 'File metadata (no bytes) for previews' })
  async meta(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    const meta = await this.files.describe(id, user.schoolId);
    if (!meta) throw new BadRequestException('File not found');
    return meta;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete an uploaded file (owner or admin)' })
  async remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    await this.files.remove(user, id);
  }
}
