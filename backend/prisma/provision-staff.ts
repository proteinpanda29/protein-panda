/**
 * Provisions one ADMIN and one DELIVERY test account, since those roles
 * deliberately can't self-signup through the OTP flow (see AuthService) —
 * they're meant to be provisioned by the business.
 *
 * Usage: npx ts-node prisma/provision-staff.ts
 *
 * To log in as either: use the phone number on the frontend login page,
 * request an OTP, then check the BACKEND terminal — in development mode
 * it prints "[DEV ONLY] OTP for <identifier>: <code>" since no real
 * SMS/email provider is wired up yet.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.upsert({
    where: { phone: '+910000000001' },
    update: {},
    create: {
      role: 'ADMIN',
      phone: '+910000000001',
      staff: { create: { name: 'Shop Admin', position: 'Manager' } },
    },
  });

  const delivery = await prisma.user.upsert({
    where: { phone: '+910000000002' },
    update: {},
    create: {
      role: 'DELIVERY',
      phone: '+910000000002',
      deliveryPerson: { create: { name: 'Test Rider' } },
    },
  });

  console.log('Admin phone:', admin.phone);
  console.log('Delivery phone:', delivery.phone);
  console.log('\nTo log in: use these numbers on the frontend login page, request an OTP,');
  console.log('then check the backend terminal for a line like "[DEV ONLY] OTP for ...: 123456".');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
