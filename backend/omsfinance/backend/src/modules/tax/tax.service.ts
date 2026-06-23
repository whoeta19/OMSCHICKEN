import { Injectable } from '@nestjs/common';
import { Prisma, VatDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface TaxOverview {
  ensBalance: string; // сальдо ЕНС
  vatToPay: string; // НДС к уплате (исходящий − вычитаемый входящий)
  vatOutgoing: string;
  vatIncoming: string;
  vatDeductible: string;
  // документы без счёта-фактуры → потенциальный недозаявленный вычет
  pendingDeductions: {
    documentId: string;
    number: string;
    counterparty: string | null;
    vatAmount: string;
  }[];
}

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId: string, period: string): Promise<TaxOverview> {
    const [account, entries] = await Promise.all([
      this.prisma.taxAccount.findUnique({ where: { organizationId } }),
      this.prisma.vatEntry.findMany({
        where: { organizationId, period },
        include: { document: { include: { counterparty: true } } },
      }),
    ]);

    const sum = (pred: (e: (typeof entries)[number]) => boolean) =>
      entries
        .filter(pred)
        .reduce((s, e) => s.add(e.vatAmount), new Prisma.Decimal(0));

    const outgoing = sum((e) => e.direction === VatDirection.OUTGOING);
    const incoming = sum((e) => e.direction === VatDirection.INCOMING);
    const deductible = sum(
      (e) => e.direction === VatDirection.INCOMING && e.deductible,
    );
    const vatToPay = outgoing.sub(deductible);

    // Входящие записи без подтверждённого вычета (нет счёта-фактуры)
    const pending = entries
      .filter((e) => e.direction === VatDirection.INCOMING && !e.deductible)
      .map((e) => ({
        documentId: e.documentId,
        number: e.document.number,
        counterparty: e.document.counterparty?.name ?? null,
        vatAmount: e.vatAmount.toString(),
      }));

    return {
      ensBalance: (account?.balance ?? new Prisma.Decimal(0)).toString(),
      vatToPay: vatToPay.toString(),
      vatOutgoing: outgoing.toString(),
      vatIncoming: incoming.toString(),
      vatDeductible: deductible.toString(),
      pendingDeductions: pending,
    };
  }
}
