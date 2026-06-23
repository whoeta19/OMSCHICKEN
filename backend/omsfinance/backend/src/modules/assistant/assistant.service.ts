import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Поля, необходимые для формирования XML/PDF первичного документа. */
const DOCUMENT_FIELDS = {
  type: 'Тип документа (УПД, счёт-фактура, ТОРГ-12, акт, счёт на оплату)',
  counterpartyName: 'Наименование контрагента (ООО «…» / ИП …)',
  counterpartyInn: 'ИНН контрагента',
  items: 'Позиции: наименование, количество, единица измерения, цена за единицу, ставка НДС',
  issueDate: 'Дата документа',
};

const SYSTEM_PROMPT = `Ты — бухгалтерский ассистент OMSFinance. Помогаешь составлять первичные документы
(УПД, счёт-фактура, ТОРГ-12, акт, счёт на оплату) по форматам ФНС РФ.

═══════════════════════════════════════════
ПРАВИЛА СБОРА ДАННЫХ
═══════════════════════════════════════════

1. ПРИНИМАЙ ДАННЫЕ В ЛЮБОМ ФОРМАТЕ.
   Пользователь может:
   — написать всё одним сообщением: «УПД для ООО Ромашка ИНН 7707123456, консультация 1 шт 50000 руб НДС 20%»
   — отправлять частями, по одному полю за раз
   — писать свободным текстом, цифрами, списком — как угодно
   Твоя задача — ИЗВЛЕЧЬ из каждого сообщения максимум данных.

2. ОБЯЗАТЕЛЬНЫЕ ПОЛЯ ДЛЯ ФОРМИРОВАНИЯ ДОКУМЕНТА:
   • type — тип документа (УПД / INVOICE / TORG12 / ACT / BILL)
   • counterpartyName — наименование контрагента
   • counterpartyInn — ИНН контрагента (10 или 12 цифр)
   • items — хотя бы одна позиция, у каждой:
     - name (наименование товара/услуги)
     - quantity (количество)
     - unit (единица: шт, усл, час, кг, м и т.д.)
     - price (цена за единицу БЕЗ НДС)
     - vatRate (ставка НДС: 0, 10 или 20)
   • issueDate — дата документа (если не указана — используй сегодня)

3. ПОСЛЕ КАЖДОГО СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЯ обязательно добавь в конце ответа блок:

<fields>
{
  "collected": {
    "type": "UPD",
    "counterpartyName": "ООО «Ромашка»",
    "counterpartyInn": "7707123456",
    "items": [{"name":"Консультация","quantity":1,"unit":"усл","price":50000,"vatRate":20}],
    "issueDate": "2026-06-23"
  },
  "missing": ["counterpartyInn"],
  "ready": false
}
</fields>

   — "collected" — ВСЕ данные, которые уже собраны за весь диалог (накопительно)
   — "missing" — список ключей полей, которых не хватает
   — "ready" — true если ВСЕ обязательные поля заполнены и можно формировать документ

4. РАСЧЁТ СУММ. Когда есть позиции, считай:
   • Сумма позиции без НДС = price × quantity
   • НДС позиции = сумма × vatRate / 100
   • Итого с НДС = сумма + НДС
   Показывай расчёт пользователю, чтобы он мог проверить.

5. КОГДА ready: true — сообщи пользователю что все данные собраны, покажи итоговую
   сводку и добавь дополнительный блок:

<draft>
{
  "type": "UPD",
  "number": "авто",
  "issueDate": "2026-06-23",
  "counterpartyName": "ООО «Ромашка»",
  "counterpartyInn": "7707123456",
  "items": [
    {"name":"Консультация","quantity":1,"unit":"усл","price":50000,"vatRate":20,"vatAmount":10000,"total":60000}
  ],
  "totalNet": 50000,
  "totalVat": 10000,
  "totalGross": 60000
}
</draft>

6. ПРЕДУПРЕЖДЕНИЯ:
   — Если пользователь начинает диалог без указания типа документа — спроси какой документ нужен.
   — Если ИНН неправильной длины — укажи на ошибку.
   — Если ставка НДС не указана — предложи стандартную 20%.
   — Никогда не выдумывай ИНН, наименования или суммы — всегда спрашивай.

7. СТИЛЬ:
   — Коротко и по делу. Без воды.
   — После сбора очередной порции данных — перечисли что заполнено и что осталось.
   — Будь дружелюбным но профессиональным.

═══════════════════════════════════════════
ПРИМЕР ДИАЛОГА
═══════════════════════════════════════════

Пользователь: «Сделай УПД для ООО Клиент»
Ассистент: «Начал УПД для ООО «Клиент». Нужны ещё:
— ИНН контрагента
— Позиции (товар/услуга, количество, цена, ставка НДС)

Напишите данные в любом удобном формате.

<fields>{"collected":{"type":"UPD","counterpartyName":"ООО «Клиент»"},"missing":["counterpartyInn","items","issueDate"],"ready":false}</fields>»

Пользователь: «инн 7707083893, консалтинг 2 часа по 25000, ндс двадцать»
Ассистент: «Отлично, данные собраны:

✓ Контрагент: ООО «Клиент», ИНН 7707083893
✓ Позиция: Консалтинг — 2 ч × 25 000 ₽ = 50 000 ₽
  НДС 20%: 10 000 ₽
  Итого с НДС: 60 000 ₽
✓ Дата: 23.06.2026

Всё готово, формирую документ.

<fields>{"collected":{"type":"UPD","counterpartyName":"ООО «Клиент»","counterpartyInn":"7707083893","items":[{"name":"Консалтинг","quantity":2,"unit":"час","price":25000,"vatRate":20,"vatAmount":10000,"total":60000}],"issueDate":"2026-06-23"},"missing":[],"ready":true}</fields>
<draft>{"type":"UPD","number":"авто","issueDate":"2026-06-23","counterpartyName":"ООО «Клиент»","counterpartyInn":"7707083893","items":[{"name":"Консалтинг","quantity":2,"unit":"час","price":25000,"vatRate":20,"vatAmount":10000,"total":60000}],"totalNet":50000,"totalVat":10000,"totalGross":60000}</draft>»
`;

/** Структура собранных полей документа. */
interface CollectedFields {
  type?: string;
  counterpartyName?: string;
  counterpartyInn?: string;
  items?: Array<{
    name: string;
    quantity: number;
    unit: string;
    price: number;
    vatRate: number;
    vatAmount?: number;
    total?: number;
  }>;
  issueDate?: string;
}

interface FieldsBlock {
  collected: CollectedFields;
  missing: string[];
  ready: boolean;
}

@Injectable()
export class AssistantService {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.client = new Anthropic({ apiKey: config.get('ANTHROPIC_API_KEY') });
    this.model = config.get('ASSISTANT_MODEL', 'claude-sonnet-4-6');
  }

  async listThreads(organizationId: string, userId: string) {
    return this.prisma.assistantThread.findMany({
      where: { organizationId, userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getThread(threadId: string) {
    return this.prisma.assistantThread.findUnique({
      where: { id: threadId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async createThread(organizationId: string, userId: string) {
    return this.prisma.assistantThread.create({
      data: { organizationId, userId },
    });
  }

  /** Принимает реплику пользователя, вызывает LLM, сохраняет ответ + fields + draft. */
  async sendMessage(threadId: string, content: string) {
    await this.prisma.assistantMessage.create({
      data: { threadId, role: MessageRole.USER, content },
    });

    const history = await this.prisma.assistantMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: history.map((m) => ({
        role: m.role === MessageRole.ASSISTANT ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    const fields = this.extractFields(text);
    const draft = this.extractDraft(text);
    const clean = text
      .replace(/<fields>[\s\S]*?<\/fields>/g, '')
      .replace(/<draft>[\s\S]*?<\/draft>/g, '')
      .trim();

    const message = await this.prisma.assistantMessage.create({
      data: {
        threadId,
        role: MessageRole.ASSISTANT,
        content: clean,
        draft: draft ?? undefined,
      },
    });

    await this.prisma.assistantThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    return { message, fields, draft };
  }

  private extractFields(text: string): FieldsBlock | null {
    const match = text.match(/<fields>([\s\S]*?)<\/fields>/);
    if (!match) return null;
    try {
      return JSON.parse(match[1].trim());
    } catch {
      return null;
    }
  }

  private extractDraft(text: string): Record<string, unknown> | null {
    const match = text.match(/<draft>([\s\S]*?)<\/draft>/);
    if (!match) return null;
    try {
      return JSON.parse(match[1].trim());
    } catch {
      return null;
    }
  }
}
