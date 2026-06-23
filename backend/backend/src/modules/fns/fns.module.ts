import { Module } from '@nestjs/common';
import { FnsService } from './fns.service';
import { FnsController } from './fns.controller';
@Module({ controllers: [FnsController], providers: [FnsService] })
export class FnsModule {}
