import { PrismaClient } from '@prisma/client';
import { seedDemo } from '../src/seed-data';

const prisma = new PrismaClient();

seedDemo(prisma)
  .then(async () => {
    const counts = {
      departments: await prisma.department.count(),
      staff: await prisma.staff.count(),
      tickets: await prisma.ticket.count(),
    };
    console.log('Seeded Masaka Hospital demo data:', counts);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
