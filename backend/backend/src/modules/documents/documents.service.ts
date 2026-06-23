import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VatDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentXmlService } from './document-xml.service';
import { DocumentPdfService } from './document-pdf.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xml: DocumentXmlService,
    private readonly pdf: DocumentPdfService,
  ) {}

  list(organizationId: string) {
    return this.prisma.document.findMany({
      where: { organizationId },
      orderBy: { issueDate: 'desc' },
      include: { counterparty: true },
    });
  }

  async create(organizationId: string, dto: CreateDocumentDto) {
    // Считаем суммы из позиций
    const items = dto.items.map((i, position) => {
      const net = new Prisma.Decimal(i.price).mul(i.quantity);
      const vat = net.mul(i.vatRate).div(100);
      return {
        name: i.name,
        unit: i.unit ?? 'шт',
        quantity: new Prisma.Decimal(i.quantity),
        price: new Prisma.Decimal(i.price),
        vatRate: i.vatRate,
        amountNet: net,
        amountVat: vat,
        position,
      };
    });

    const amountNet = items.reduce(
      (s, i) => s.add(i.amountNet),
      new Prisma.Decimal(0),
    );
    const amountVat = items.reduce(
      (s, i) => s.add(i.amountVat),
      new Prisma.Decimal(0),
    );

    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        counterpartyId: dto.counterpartyId,
        type: dto.type,
        number: dto.number,
        issueDate: new Date(dto.issueDate),
        amountNet,
        amountVat,
        amountTotal: amountNet.add(amountVat),
        hasInvoice: dto.type === 'UPD' || dto.type === 'INVOICE',
        metadata: dto.metadata as Prisma.InputJsonValue,
        items: { create: items },
      },
      include: { items: true, organization: true, counterparty: true },
    });

    // Запись в регистр НДС
    if (amountVat.gt(0)) {
      await this.prisma.vatEntry.create({
        data: {
          organizationId,
          documentId: doc.id,
          direction: doc.counterparty?.isCustomer
            ? VatDirection.OUTGOING
            : VatDirection.INCOMING,
          period: this.periodOf(doc.issueDate),
          base: amountNet,
          vatAmount: amountVat,
          deductible: doc.hasInvoice,
        },
      });
    }

    return doc;
  }

  /** Генерация XML по формату ФНS + печатной PDF-формы. */
  async generateFiles(organizationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId },
      include: { items: true, organization: true, counterparty: true },
    });
    if (!doc) throw new NotFoundException('Документ не найден');

    const xml = this.xml.build(doc);
    const pdfBuffer = await this.pdf.render(doc);

    // Тут — загрузка в S3/MinIO и сохранение ключей.
    // const xmlKey = await this.storage.put(...);
    // const pdfKey = await this.storage.put(...);

    return {
      xml,
      pdfBase64: pdfBuffer.toString('base64'),
    };
  }

  private periodOf(date: Date): string {
    const q = Math.floor(date.getUTCMonth() / 3) + 1;
    return `${date.getUTCFullYear()}-Q${q}`;
  }
}
