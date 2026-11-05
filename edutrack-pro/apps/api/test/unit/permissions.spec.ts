import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, roleHasPermission } from '@edutrack/shared-config';

type Permission = (typeof PERMISSIONS)[number];

/**
 * Role matrix sanity checks. The API's AuthGuard reads exactly this matrix, so a
 * mistake here would be an authorisation bug in every endpoint.
 */
describe('Role permission matrix (unit)', () => {
  const catalogue = new Set<string>(PERMISSIONS);

  it('exactly three roles exist and each has a non-empty permission set', () => {
    expect([...ROLES].sort()).toEqual(['ADMIN', 'PARENT', 'TEACHER']);
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
  });

  it('only grants permissions that exist in the catalogue', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) expect(catalogue.has(permission)).toBe(true);
    }
  });

  it('gives administrators every administrative capability', () => {
    for (const permission of [
      'school:write', 'user:manage', 'class:manage', 'learner:manage', 'learning-area:manage',
      'assessment:create', 'result:publish', 'result:amend', 'timetable:generate',
      'timetable:edit', 'timetable:validate', 'timetable:publish', 'audit:read',
    ]) {
      expect(roleHasPermission('ADMIN', permission as Permission)).toBe(true);
    }
  });

  it('never lets a teacher publish a timetable, manage users or read the audit log', () => {
    for (const permission of ['timetable:publish', 'timetable:edit', 'user:manage', 'audit:read', 'school:write', 'learner:manage']) {
      expect(roleHasPermission('TEACHER', permission as Permission)).toBe(false);
    }
  });

  it('never lets a parent see drafts, enter marks or read staff data', () => {
    for (const permission of [
      'result:enter', 'result:publish', 'result:read:draft', 'assessment:create', 'learner:manage',
      'timetable:generate', 'audit:read', 'user:manage', 'school:write',
    ]) {
      expect(roleHasPermission('PARENT', permission as Permission)).toBe(false);
    }
  });

  it('keeps the three roles distinct — no role is a superset of another', () => {
    const admin = new Set(ROLE_PERMISSIONS.ADMIN);
    const teacher = new Set(ROLE_PERMISSIONS.TEACHER);
    const parent = new Set(ROLE_PERMISSIONS.PARENT);
    expect(admin.size).toBeGreaterThan(teacher.size);
    expect(admin.size).toBeGreaterThan(parent.size);
    expect(ROLE_PERMISSIONS.TEACHER.filter((p) => !parent.has(p)).length).toBeGreaterThan(0);
    expect(ROLE_PERMISSIONS.PARENT.filter((p) => !teacher.has(p)).length).toBeGreaterThan(0);
  });

  it('gives every role the timetable read access its UI needs', () => {
    expect(roleHasPermission('ADMIN', 'timetable:read:own' as Permission)).toBe(true);
    expect(roleHasPermission('TEACHER', 'timetable:read:own' as Permission)).toBe(true);
    expect(roleHasPermission('TEACHER', 'timetable:read:class' as Permission)).toBe(true);
    expect(roleHasPermission('PARENT', 'timetable:read:published-linked' as Permission)).toBe(true);
  });

  it('gives parents read access to published results and resources only', () => {
    expect(roleHasPermission('PARENT', 'result:read:published' as Permission)).toBe(true);
    expect(roleHasPermission('PARENT', 'resource:read:published' as Permission)).toBe(true);
    expect(roleHasPermission('PARENT', 'assessment:read:published' as Permission)).toBe(true);
    expect(roleHasPermission('PARENT', 'learner:read:linked' as Permission)).toBe(true);
  });
});
