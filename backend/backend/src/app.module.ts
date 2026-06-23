import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { TaxModule } from './modules/tax/tax.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { FnsModule } from './modules/fns/fns.module';
import { AssistantModule } from './modules/assistant/assistant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    DocumentsModule,
    TaxModule,
    TasksModule,
    FnsModule,
    AssistantModule,
  ],
})
export class AppModule {}
