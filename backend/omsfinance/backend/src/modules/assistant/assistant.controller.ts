import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';
import { IsString } from 'class-validator';

class SendMessageDto {
  @IsString() content: string;
}

@ApiTags('assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('threads')
  threads(@CurrentUser() u: AuthUser) {
    return this.assistant.listThreads(u.organizationId, u.userId);
  }

  @Post('threads')
  create(@CurrentUser() u: AuthUser) {
    return this.assistant.createThread(u.organizationId, u.userId);
  }

  @Get('threads/:id')
  thread(@Param('id') id: string) {
    return this.assistant.getThread(id);
  }

  @Post('threads/:id/messages')
  send(@Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.assistant.sendMessage(id, dto.content);
  }
}
