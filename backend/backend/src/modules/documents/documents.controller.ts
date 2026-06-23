import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.documents.list(u.organizationId);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateDocumentDto) {
    return this.documents.create(u.organizationId, dto);
  }

  @Post(':id/generate')
  generate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.documents.generateFiles(u.organizationId, id);
  }
}
