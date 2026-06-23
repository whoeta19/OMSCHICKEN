import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { provider_providerSub: { provider: 'YANDEX', providerSub: 'demo' } },
    update: {},
    create: {
      provider: 'YANDEX',
      providerSub: 'demo',
      email: 'demo@omsfinance.ru',
      fullName: 'Демо Пользователь',
    },
  });

  const org = await prisma.organization.upsert({
    where: { inn: '7707083893' },
    update: {},
    create: {
      name: 'ООО «Тихая роскошь»',
      kind: 'OOO',
      inn: '7707083893',
      kpp: '770701001',
      taxRegime: 'OSNO',
      vatPayer: true,
      taxAccount: { create: { balance: 124500.0 } },
    },
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: {},
    create: { userId: user.id, organizationId: org.id, role: 'OWNER' },
  });

  await prisma.task.createMany({
    data: [
      {
        organizationId: org.id,
        kind: 'TAX',
        title: 'НДС за I квартал',
        subtitle: 'Срок уплаты 28 апреля',
        amount: 86400,
        dueDate: new Date('2026-04-28'),
        priority: 10,
      },
      {
        organizationId: org.id,
        kind: 'REPORT',
        title: 'Сдать ЕФС-1',
        subtitle: 'Подраздел 1.1',
        dueDate: new Date('2026-04-25'),
        priority: 8,
      },
      {
        organizationId: org.id,
        kind: 'NAVIGATION',
        title: 'Выставить счёт новому клиенту',
        deeplink: 'create/new',
        priority: 3,
      },
    ],
  });

  // eslint-disable-next-line no-console
  console.log('Seed готов:', { user: user.email, org: org.name });
}

main().finally(() => prisma.$disconnect());
