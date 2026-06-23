import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TaxService } from './tax.service';

@ApiTags('tax')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get('overview')
  overview(@CurrentUser() u: AuthUser, @Query('period') period: string) {
    const p = period ?? this.currentPeriod();
    return this.tax.overview(u.organizationId, p);
  }

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  }
}
