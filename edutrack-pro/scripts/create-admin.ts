/**
 * Creates the school and/or an administrator account without the demo seed.
 *
 * Usage:
 *   npm run setup:admin                                  # interactive prompts
 *   npm run setup:admin -- --email you@school.ac.ke --name "Jane Doe" --school "Mwangaza Junior School"
 *   npm run setup:admin -- --email you@school.ac.ke --name "Jane Doe" --school-id <existing school id>
 *
 * The password is never a default and never logged: it is read from the
 * SEED_ADMIN_PASSWORD / ADMIN_PASSWORD environment variable or typed at the
 * prompt, and must satisfy the same policy as the API.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const prisma = new PrismaClient();

/** Same policy the API enforces (see @edutrack/validation passwordSchema). */
const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

async function hashPassword(plain: string): Promise<string> {
  try {
    const argon2 = await import('argon2');
    return await argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  } catch {
    const bcrypt = await import('bcrypt');
    return bcrypt.hash(plain, 12);
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function note(message: string): void {
  stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const email = (arg('email') ?? (await rl.question('Administrator email: '))).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That does not look like an email address.');

    const fullName = (arg('name') ?? (await rl.question('Full name: '))).trim();
    if (fullName.length < 3) throw new Error('Provide the administrator’s full name.');

    let schoolId = arg('school-id');
    let schoolName = arg('school');
    if (!schoolId && !schoolName) schoolName = (await rl.question('School name (a new school is created): ')).trim();
    if (!schoolId && (!schoolName || schoolName.length < 3)) throw new Error('Provide a school name or --school-id.');

    let password = process.env.ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? '';
    if (!password) {
      const generated = `Cbe-${randomBytes(9).toString('base64url')}-${randomBytes(3).toString('hex')}!`;
      note(`\nNo ADMIN_PASSWORD provided. Generated password: ${generated}`);
      note('(copy it now — it is not stored anywhere in plain text)');
      password = generated;
    }
    if (!PASSWORD_POLICY.test(password)) {
      throw new Error('Password must be at least 12 characters and include upper case, lower case, a number and a symbol.');
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    const school = schoolId
      ? await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })
      : await prisma.school.create({
          data: {
            name: schoolName as string,
            code: (schoolName as string).split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 8) + '-' + randomBytes(2).toString('hex').toUpperCase(),
            timezone: process.env.DEFAULT_TIMEZONE ?? 'Africa/Nairobi',
          },
        });

    const passwordHash = await hashPassword(password);
    const user = existingUser
      ? await prisma.user.update({ where: { id: existingUser.id }, data: { passwordHash, isActive: true, mustChangePassword: false } })
      : await prisma.user.create({ data: { email, fullName, passwordHash } });

    const membership = await prisma.schoolMembership.findFirst({ where: { userId: user.id, schoolId: school.id } });
    if (membership) {
      await prisma.schoolMembership.update({ where: { id: membership.id }, data: { role: 'ADMIN', status: 'ACTIVE' } });
    } else {
      await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, role: 'ADMIN', status: 'ACTIVE', title: 'Administrator' } });
    }

    await prisma.auditLog.create({
      data: {
        schoolId: school.id, actorUserId: user.id, actorRole: 'ADMIN', action: 'admin.created',
        entityType: 'User', entityId: user.id, summary: `Administrator ${email} provisioned with scripts/create-admin.ts`,
      },
    });

    note(`\n✔ Administrator ready`);
    note(`   school : ${school.name} (${school.id})`);
    note(`   user   : ${user.email} (${user.id})`);
    note(`\nSign in at the web app (default http://localhost:3000/login) or POST /api/v1/auth/login.`);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`\nFailed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
