# OMSFinance · Backend

API для карманной бухгалтерии малого и среднего бизнеса в РФ.

## Стек

- **NestJS 11** (TypeScript, модульная архитектура)
- **PostgreSQL 16** + **Prisma 6** (ORM, миграции, типобезопасность)
- **Redis 7** — кэш и rate-limiting
- **MinIO (S3)** — хранение PDF/XML документов, печатей и подписей
- **Anthropic SDK** — ИИ-ассистент составления первички (модель `claude-sonnet-4-6`)
- **JWT** (access + refresh), **Helmet**, **Throttler**, **Swagger**

## Структура

```
backend/
├── prisma/
│   ├── schema.prisma        # полная доменная модель (User, Organization, Document, Tax…, Report…)
│   └── seed.ts              # демо-данные: пользователь, ООО «Тихая роскошь», задачи
├── src/
│   ├── main.ts              # bootstrap: helmet, CORS, /api, версии v1, Swagger /docs
│   ├── app.module.ts
│   ├── common/              # guards, decorators (CurrentUser, JwtAuthGuard)
│   ├── prisma/              # PrismaService (@Global)
│   └── modules/
│       ├── auth/            # вход через Яндекс / Apple / ЭЦП, выдача и обновление токенов
│       ├── documents/       # CRUD + генерация PDF (pdfkit) и XML по форматам ФНС (xmlbuilder2)
│       ├── tax/             # обзор: сальдо ЕНС, НДС к уплате, вычеты по недостающим СФ
│       ├── tasks/           # налоговые/отчётные/навигационные задачи
│       ├── fns/             # письма, требования, отправленные отчёты (ФНС/СФР/ПФР/ЕФС)
│       └── assistant/       # чат-ассистент: треды, сообщения, извлечение черновиков <draft>
├── Dockerfile
├── package.json
└── .env.example
```

## Быстрый старт (Docker, рекомендуется)

Из корня репозитория:

```bash
cp backend/.env.example backend/.env   # заполните секреты (как минимум ANTHROPIC_API_KEY)
docker compose up --build
```

Поднимутся: API (`:3000`), PostgreSQL (`:5432`), Redis (`:6379`), MinIO (`:9000`, консоль `:9001`).
Контейнер API при старте автоматически применяет миграции (`prisma migrate deploy`).

Документация API: <http://localhost:3000/docs>

### Сиды (демо-данные)

```bash
docker compose exec api npm run prisma:seed
```

## Локальный запуск (без Docker)

Нужны Node ≥ 22 и запущенный PostgreSQL.

```bash
cd backend
npm install
cp .env.example .env                   # пропишите DATABASE_URL и прочее
npm run prisma:generate
npm run prisma:migrate:dev             # создаст и применит миграции
npm run prisma:seed                    # опционально
npm run start:dev                      # http://localhost:3000/api/v1
```

## Переменные окружения

См. `.env.example`. Ключевые:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | строка подключения PostgreSQL |
| `REDIS_URL` | подключение Redis |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | секреты токенов |
| `ANTHROPIC_API_KEY` | ключ для ИИ-ассистента |
| `ASSISTANT_MODEL` | модель (по умолчанию `claude-sonnet-4-6`) |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | MinIO/S3 |
| `YANDEX_CLIENT_ID` / `APPLE_*` | OAuth-провайдеры |

## Основные эндпоинты (`/api/v1`)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/login` | вход через провайдера (Яндекс/Apple/ЭЦП) |
| POST | `/auth/refresh` | обновление токенов |
| GET | `/tasks` · `/tasks/summary` | список задач, сводка |
| PATCH | `/tasks/:id/complete` | закрыть задачу |
| GET | `/tax/overview?period=` | сальдо ЕНС, НДС, вычеты |
| GET · POST | `/documents` | список / создание документа |
| POST | `/documents/:id/generate` | PDF + XML по формату ФНС |
| GET · POST | `/assistant/threads` | треды ассистента |
| POST | `/assistant/threads/:id/messages` | сообщение → ответ + черновик |
| GET | `/fns/messages` · `/fns/reports` | письма/требования, отчёты |

## Замечания по продакшену

- Токены на клиенте хранить в Keychain (в скаффолде — in-memory `TokenStore`).
- Реальные интеграции (ЕГРЮЛ/ЕГРИП, оператор ЭДО, банковские выписки) подключаются как отдельные провайдеры в соответствующих модулях.
- XML-генерация использует КНД-коды и формат 5.03; перед боем сверяйте с актуальными приказами ФНС.
