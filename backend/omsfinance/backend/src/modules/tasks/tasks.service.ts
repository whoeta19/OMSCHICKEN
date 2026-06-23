import { Injectable } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Лента задач: налоги/взносы + навигационные подсказки. */
  list(organizationId: string) {
    return this.prisma.task.findMany({
      where: { organizationId, status: { not: TaskStatus.DONE } },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
    });
  }

  complete(organizationId: string, id: string) {
    return this.prisma.task.updateMany({
      where: { id, organizationId },
      data: { status: TaskStatus.DONE },
    });
  }

  /** Сводка для BIG-блока сверху экрана «Задачи». */
  async summary(organizationId: string) {
    const tasks = await this.list(organizationId);
    const overdue = tasks.filter((t) => t.status === TaskStatus.OVERDUE).length;
    const dueAmount = tasks
      .filter((t) => t.amount)
      .reduce((s, t) => s + Number(t.amount), 0);
    return { total: tasks.length, overdue, dueAmount };
  }
}
