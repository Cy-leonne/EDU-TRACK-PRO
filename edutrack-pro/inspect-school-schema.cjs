require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'School'
    ORDER BY ordinal_position
  `;
  console.table(columns);

  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM public."_prisma_migrations"
    ORDER BY started_at
  `;
  console.table(migrations);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
