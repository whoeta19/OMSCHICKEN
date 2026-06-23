import { Injectable } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import { Document, DocumentItem, Organization, Counterparty } from '@prisma/client';

type FullDocument = Document & {
  items: DocumentItem[];
  organization: Organization;
  counterparty: Counterparty | null;
};

/**
 * Формирует XML по требованиям ФНС (упрощённая модель формата УПД/счёта-фактуры,
 * приказ ФНС ED-7-26). В проде ведётся версионирование форматов через
 * справочник версий приказов; здесь — production-ready каркас под расширение.
 */
@Injectable()
export class DocumentXmlService {
  build(doc: FullDocument): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('Файл', {
      ИдФайл: `OMS_${doc.type}_${doc.number}`,
      ВерсФорм: '5.03',
      ВерсПрог: 'OMSFinance 1.0',
    });

    const docEle = root.ele('Документ', {
      КНД: this.kndCode(doc.type),
      ДатаДок: this.fmtDate(doc.issueDate),
      НомерДок: doc.number,
    });

    // Продавец
    docEle
      .ele('СвПродПер')
      .ele('СвПрод')
      .ele('ИдСв')
      .ele('СвЮЛУч', {
        НаимОрг: doc.organization.name,
        ИННЮЛ: doc.organization.inn,
        КПП: doc.organization.kpp ?? '',
      });

    // Покупатель
    if (doc.counterparty) {
      docEle
        .ele('СвПокуп')
        .ele('ИдСв')
        .ele('СвЮЛУч', {
          НаимОрг: doc.counterparty.name,
          ИННЮЛ: doc.counterparty.inn,
          КПП: doc.counterparty.kpp ?? '',
        });
    }

    // Табличная часть
    const table = docEle.ele('ТаблСчФакт');
    doc.items.forEach((item, idx) => {
      table.ele('СведТов', {
        НомСтр: String(idx + 1),
        НаимТов: item.name,
        ОКЕИ_Тов: '796', // штука
        КолТов: item.quantity.toString(),
        ЦенаТов: item.price.toString(),
        СтТовБезНДС: item.amountNet.toString(),
        НалСт: `${item.vatRate}%`,
        СтТовУчНал: item.amountNet.add(item.amountVat).toString(),
      }).ele('СумНал').ele('СумНал').txt(item.amountVat.toString());
    });

    // Итоги
    docEle.ele('ВсегоОпл', {
      СтТовБезНДСВсего: doc.amountNet.toString(),
      СтТовУчНалВсего: doc.amountTotal.toString(),
    }).ele('СумНалВсего').ele('СумНал').txt(doc.amountVat.toString());

    return root.end({ prettyPrint: true });
  }

  private kndCode(type: string): string {
    // Коды по налоговой декларации (КНД)
    const map: Record<string, string> = {
      UPD: '1115131',
      INVOICE: '1115101',
      TORG12: '1175011',
      ACT: '1175012',
    };
    return map[type] ?? '0000000';
  }

  private fmtDate(d: Date): string {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()}`;
  }
}
