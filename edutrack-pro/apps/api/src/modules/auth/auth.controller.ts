import {
  Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  acceptInvitationSchema, accountStatusSchema, changePasswordSchema, firstAdminSetupSchema, forgotPasswordSchema, invitationCreateSchema,
  invitationRevokeSchema, loginSchema, parentLinkRequestSchema, parentRegistrationSchema, refreshSchema,
  resetPasswordSchema, schoolRegistrationSchema,
} from '@edutrack/validation';
import { CurrentUser, Public, RequirePermissions, Roles } from '../../common/decorators';
import type { AuthPrincipal } from '../../common/guards/auth.guard';
import { zodPipe } from '../../common/pipes';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { IpRateLimitGuard } from './ip-rate-limit.guard';

/**
 * Cookie strategy (web client)
 *  * `edutrack_access_token`  - httpOnly, SameSite=Lax, short lived.
 *  * `edutrack_refresh_token` - httpOnly, SameSite=Strict, path-scoped to this API.
 *  * WEB responses contain user context only; the Next proxy forwards cookies.
 *  * MOBILE clients explicitly request tokens in JSON for secure native storage.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(IpRateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly registration: RegistrationService,
  ) {}

  private cookieOptions(maxAgeSeconds: number, opts: { strict?: boolean } = {}) {
    const secure = this.config.get<boolean>('auth.cookieSecure') ?? false;
    const domain = this.config.get<string>('auth.cookieDomain');
    return {
      httpOnly: true,
      secure,
      sameSite: (opts.strict ? 'strict' : 'lax') as 'strict' | 'lax',
      domain: domain || undefined,
      path: '/',
      maxAge: maxAgeSeconds * 1000,
    };
  }

  private setCookies(res: Response, accessToken: string, refreshToken: string, expiresIn: number, refreshExpiresAt: Date): void {
    res.cookie('edutrack_access_token', accessToken, this.cookieOptions(expiresIn));
    res.cookie('edutrack_refresh_token', refreshToken, {
      ...this.cookieOptions(Math.max(60, Math.floor((refreshExpiresAt.getTime() - Date.now()) / 1000)), { strict: true }),
      path: `${this.config.get<string>('apiPrefix') ?? '/api/v1'}/auth`,
    });
  }

  private clientResponse<T extends { accessToken: string; refreshToken: string; expiresIn: number; user: unknown }>(
    result: T,
    clientType: 'WEB' | 'MOBILE',
  ) {
    if (clientType === 'MOBILE') return result;
    return { user: result.user, expiresIn: result.expiresIn };
  }

  @Public()
  @Get('setup-status')
  @ApiOperation({ summary: 'Whether first-run administrator setup is still available' })
  async setupStatus() {
    const policy = await this.registration.policy();
    const enabled = this.auth.setupEnabled();
    return {
      // retained for existing clients
      firstRunSetupEnabled: policy.firstRunSetupEnabled || (enabled && policy.schoolCount === 0),
      requiresSetup: policy.schoolCount === 0,
      // onboarding routes the sign-in page may offer
      schoolSelfRegistration: policy.schoolSelfRegistration,
      parentSelfRegistration: policy.parentSelfRegistration,
      invitationRegistration: policy.invitationRegistration,
      hint: enabled ? 'POST /auth/setup/first-admin with the INITIAL_ADMIN_SETUP_TOKEN.' : 'Setup disabled. Use `npm run setup:admin`.',
    };
  }

  @Public()
  @Post('setup/first-admin')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create the first school + administrator using the server setup token (one time)' })
  async firstAdmin(
    @Body(zodPipe(firstAdminSetupSchema)) dto: Parameters<AuthService['setupFirstAdmin']>[0],
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setupFirstAdmin(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, result.accessToken, result.refreshToken, result.expiresIn, result.refreshExpiresAt);
    return this.clientResponse(result, 'WEB');
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body(zodPipe(loginSchema)) dto: Parameters<AuthService['login']>[0],
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, result.accessToken, result.refreshToken, result.expiresIn, result.refreshExpiresAt);
    return this.clientResponse(result, dto.clientType);
  }

  @Public()
  @Post('platform/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in to the isolated platform administration portal' })
  async platformLogin(
    @Body(zodPipe(loginSchema)) dto: Parameters<AuthService['platformLogin']>[0],
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.platformLogin(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, result.accessToken, result.refreshToken, result.expiresIn, result.refreshExpiresAt);
    return this.clientResponse(result, dto.clientType);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  async refresh(
    @Body(zodPipe(refreshSchema)) body: { refreshToken?: string; clientType: 'WEB' | 'MOBILE' },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body.refreshToken ?? (req.cookies?.['edutrack_refresh_token'] as string | undefined);
    if (!token) throw new UnauthorizedException('No active session. Please sign in.');
    const result = await this.auth.refresh(token, body.clientType, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, result.accessToken, result.refreshToken, result.expiresIn, result.refreshExpiresAt);
    return this.clientResponse(result, body.clientType);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out and revoke the current refresh token' })
  async logout(
    @Req() req: Request & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    const token = (req.cookies?.['edutrack_refresh_token'] as string | undefined) ?? (req.body?.refreshToken as string | undefined);
    await this.auth.logout(token, user?.userId, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    res.clearCookie('edutrack_access_token', { path: '/' });
    res.clearCookie('edutrack_refresh_token', { path: `${this.config.get('apiPrefix')}/auth` });
    return { signedOut: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user, role, school and resolved permissions' })
  async me(@CurrentUser() user: AuthPrincipal) {
    return this.auth.buildAuthUser(user.userId, user.schoolId, user.membershipId, user.role);
  }

  @Post('password/change')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change my password (revokes all other sessions)' })
  async changePassword(
    @CurrentUser() user: AuthPrincipal,
    @Body(zodPipe(changePasswordSchema)) dto: { currentPassword: string; newPassword: string },
    @Req() req: Request,
  ) {
    return this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a password reset link (response is always generic)' })
  async forgot(@Body(zodPipe(forgotPasswordSchema)) dto: { email: string }, @Req() req: Request) {
    return this.auth.requestPasswordReset(dto.email, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete a password reset with a valid token' })
  async reset(@Body(zodPipe(resetPasswordSchema)) dto: { token: string; password: string }, @Req() req: Request) {
    return this.auth.resetPassword(dto.token, dto.password, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  /* --------------------------- registration --------------------------- */

  @Public()
  @Post('register/school')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a school and its first administrator (setup token or self-service, per policy)' })
  async registerSchool(
    @Body(zodPipe(schoolRegistrationSchema)) dto: Parameters<RegistrationService['registerSchool']>[0],
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.registration.registerSchool(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, result.accessToken, result.refreshToken, result.expiresIn, result.refreshExpiresAt);
    return this.clientResponse(result, 'WEB');
  }

  @Public()
  @Post('register/parent')
  @HttpCode(201)
  @ApiOperation({ summary: 'Guardian self-registration (invitation link, or the school code)' })
  async registerParent(@Body(zodPipe(parentRegistrationSchema)) dto: Parameters<RegistrationService['registerParent']>[0], @Req() req: Request) {
    return this.registration.registerParent(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  /* --------------------------- invitations ---------------------------- */

  @Public()
  @Get('invitations/preview')
  @ApiOperation({ summary: 'Check an invitation link before signing up' })
  async invitationPreview(@Query('token') token?: string) {
    if (!token) throw new UnauthorizedException('An invitation token is required.');
    return this.registration.previewInvitation(token);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an invitation: set your own password and activate the account' })
  async acceptInvitation(@Body(zodPipe(acceptInvitationSchema)) dto: Parameters<RegistrationService['acceptInvitation']>[0], @Req() req: Request) {
    return this.registration.acceptInvitation(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('invitations')
  @HttpCode(201)
  @ApiBearerAuth()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Invite a teacher, administrator or guardian to this school' })
  async createInvitation(
    @CurrentUser() user: AuthPrincipal,
    @Body(zodPipe(invitationCreateSchema)) dto: Parameters<RegistrationService['createInvitation']>[1],
    @Req() req: Request,
  ) {
    return this.registration.createInvitation(user, dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('invitations')
  @ApiBearerAuth()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Pending invitations for this school' })
  async listInvitations(@CurrentUser() user: AuthPrincipal) {
    return this.registration.listInvitations(user);
  }

  @Post('invitations/:id/revoke')
  @HttpCode(200)
  @ApiBearerAuth()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(invitationRevokeSchema)) body: { reason?: string },
    @Req() req: Request,
  ) {
    return this.registration.revokeInvitation(user, id, body?.reason, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  /* ------------------------ account lifecycle ------------------------- */

  @Post('accounts/:userId/password-reset-link')
  @HttpCode(200)
  @ApiBearerAuth()
  @RequirePermissions('user:manage')
  @ApiOperation({
    summary: 'Issue a single-use password reset link on behalf of a user (for schools without email configured)',
  })
  async issueResetLink(@CurrentUser() user: AuthPrincipal, @Param('userId') userId: string, @Req() req: Request) {
    return this.registration.issueResetLink(user, userId, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('accounts/:userId/status')
  @HttpCode(200)
  @ApiBearerAuth()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Activate or deactivate an account in your school (revokes its sessions)' })
  async setAccountStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId') userId: string,
    @Body(zodPipe(accountStatusSchema)) body: { isActive: boolean },
    @Req() req: Request,
  ) {
    return this.registration.setAccountActive(user, userId, body.isActive, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('logout-all')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out of every device (revokes all refresh tokens)' })
  async logoutAll(@CurrentUser() user: AuthPrincipal, @Req() req: Request) {
    await this.auth.logoutAll(user.userId, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return { signedOutEverywhere: true };
  }

  @Post('parent/link-request')
  @HttpCode(202)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Parent requests a link to a learner (assessment number + surname). A school administrator must verify it.',
  })
  async parentLinkRequest(
    @CurrentUser() user: AuthPrincipal,
    @Body(zodPipe(parentLinkRequestSchema)) dto: Parameters<AuthService['requestParentLink']>[1],
    @Req() req: Request,
  ) {
    return this.auth.requestParentLink(user.userId, dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }
}
