# ── Stage 1: deps + build ─────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Системные зависимости для bcrypt / prisma
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# ── Stage 2: runtime ──────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Запуск под непривилегированным пользователем
USER node

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
