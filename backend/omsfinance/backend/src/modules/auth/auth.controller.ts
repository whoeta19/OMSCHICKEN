import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ProviderLoginDto, RefreshDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // В реальном проекте код верифицируется в провайдер-специфичных
  // сервисах (Яндекс OAuth, Apple Sign In, проверка ЭЦП по ГОСТ).
  // Здесь — единая точка после верификации профиля.
  @Post('login')
  login(@Body() dto: ProviderLoginDto, @Req() req: any) {
    return this.auth.loginWithProvider(
      {
        provider: dto.provider,
        sub: dto.sub,
        email: dto.email,
        fullName: dto.fullName,
        ecpThumbprint: dto.ecpThumbprint,
      },
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
}
