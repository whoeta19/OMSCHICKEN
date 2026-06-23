import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FnsService {
  constructor(private readonly prisma: PrismaService) {}

  // Письма / требования / уведомления
  messages(organizationId: string) {
    return this.prisma.fnsMessage.findMany({
      where: { organizationId },
      orderBy: { receivedAt: 'desc' },
    });
  }

  markRead(organizationId: string, id: string) {
    return this.prisma.fnsMessage.updateMany({
      where: { id, organizationId },
      data: { isRead: true },
    });
  }

  // Отправленные отчёты в ФНС / СФР / ПФР / ЕФС
  reports(organizationId: string) {
    return this.prisma.report.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
