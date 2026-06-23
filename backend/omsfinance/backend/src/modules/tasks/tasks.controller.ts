import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.tasks.list(u.organizationId); }
  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.tasks.summary(u.organizationId); }
  @Patch(':id/complete') complete(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.tasks.complete(u.organizationId, id);
  }
}
