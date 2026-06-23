import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FnsService } from './fns.service';

@ApiTags('fns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fns')
export class FnsController {
  constructor(private readonly fns: FnsService) {}

  @Get('messages') messages(@CurrentUser() u: AuthUser) { return this.fns.messages(u.organizationId); }
  @Patch('messages/:id/read') read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fns.markRead(u.organizationId, id);
  }
  @Get('reports') reports(@CurrentUser() u: AuthUser) { return this.fns.reports(u.organizationId); }
}
