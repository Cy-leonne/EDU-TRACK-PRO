import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AppRole, Permission } from '@edutrack/shared-config';
import type { AuthPrincipal } from '../guards/auth.guard';

export const IS_PUBLIC_KEY = 'isPublic';
export const RAW_RESPONSE_KEY = 'rawResponse';
export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

/** Marks a route as reachable without authentication (login, health, setup). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given roles (in addition to permission checks). */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Marks a route as producing a non-JSON body (CSV downloads today).
 *
 * The global envelope interceptor wraps everything in `{ success, data }`, which is
 * exactly right for the API and exactly wrong for a file download: a browser saving
 * the response would get JSON instead of a spreadsheet. Routes marked with this
 * decorator are streamed exactly as the controller wrote them.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

/** Requires the caller to hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Injects the authenticated principal (never the raw token). */
export const CurrentUser = createParamDecorator((data: keyof AuthPrincipal | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
  if (!data) return request.user;
  return request.user?.[data];
});

/** Injects the caller's school id - the tenant boundary for every query. */
export const CurrentSchool = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
  return request.user?.schoolId;
});

export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ requestId?: string }>();
  return request.requestId;
});
