import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Document, DocumentItem, Organization, Counterparty } from '@prisma/client';

type FullDocument = Document & {
  items: DocumentItem[];
  organization: Organization;
  counterparty: Counterparty | null;
};

const TITLES: Record<string, string> = {
  UPD: 'Универсальный передаточный документ',
  INVOICE: 'Счёт-фактура',
  BILL: 'Счёт на оплату',
  TORG12: 'Товарная накладная (ТОРГ-12)',
  ACT: 'Акт выполненных работ',
  CONTRACT: 'Договор',
  RECONCILIATION: 'Акт сверки',
};

/** Рендерит печатную PDF-форму. Возвращает Buffer для выгрузки в S3. */
@Injectable()
export class DocumentPdfService {
  async render(doc: FullDocument): Promise<Buffer> {
    const pdf = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));

    const done = new Promise<Buffer>((resolve) => {
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const title = TITLES[doc.type] ?? 'Документ';
    pdf.fontSize(16).text(`${title} № ${doc.number}`, { align: 'left' });
    pdf.moveDown(0.3);
    pdf.fontSize(10).fillColor('#666').text(
      `от ${doc.issueDate.toLocaleDateString('ru-RU')}`,
    );
    pdf.fillColor('#000').moveDown(1);

    pdf.fontSize(10).text(`Продавец: ${doc.organization.name}, ИНН ${doc.organization.inn}`);
    if (doc.counterparty) {
      pdf.text(`Покупатель: ${doc.counterparty.name}, ИНН ${doc.counterparty.inn}`);
    }
    pdf.moveDown(1);

    // Таблица позиций
    pdf.fontSize(9);
    const top = pdf.y;
    pdf.text('№', 48, top);
    pdf.text('Наименование', 80, top);
    pdf.text('Кол-во', 320, top);
    pdf.text('Цена', 380, top);
    pdf.text('Сумма', 460, top);
    pdf.moveTo(48, top + 14).lineTo(547, top + 14).stroke();

    let y = top + 20;
    doc.items.forEach((item, i) => {
      pdf.text(String(i + 1), 48, y);
      pdf.text(item.name, 80, y, { width: 230 });
      pdf.text(item.quantity.toString(), 320, y);
      pdf.text(item.price.toString(), 380, y);
      pdf.text(item.amountNet.add(item.amountVat).toString(), 460, y);
      y += 18;
    });

    pdf.moveTo(48, y + 2).lineTo(547, y + 2).stroke();
    pdf.fontSize(10).text(`Итого без НДС: ${doc.amountNet} ₽`, 320, y + 10);
    pdf.text(`НДС: ${doc.amountVat} ₽`, 320, y + 26);
    pdf.font('Helvetica-Bold').text(`Всего к оплате: ${doc.amountTotal} ₽`, 320, y + 44);

    pdf.end();
    return done;
  }
}
