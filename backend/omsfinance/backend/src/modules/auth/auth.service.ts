import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ProviderProfile {
  provider: AuthProvider;
  sub: string; // уникальный id у провайдера
  email?: string;
  fullName?: string;
  ecpThumbprint?: string; // для входа по ЭЦП
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Унифицированный вход. На вход — верифицированный профиль провайдера
   * (Яндекс / Apple / ЭЦП). Создаёт пользователя при первом входе.
   */
  async loginWithProvider(
    profile: ProviderProfile,
    meta: { ip?: string; userAgent?: string },
  ): Promise<TokenPair & { onboarded: boolean }> {
    const user = await this.prisma.user.upsert({
      where: {
        provider_providerSub: {
          provider: profile.provider,
          providerSub: profile.sub,
        },
      },
      update: { email: profile.email, fullName: profile.fullName },
      create: {
        provider: profile.provider,
        providerSub: profile.sub,
        email: profile.email,
        fullName: profile.fullName,
        ecpThumbprint: profile.ecpThumbprint,
      },
      include: { memberships: true },
    });

    const orgId = user.memberships[0]?.organizationId ?? '';
    const role = user.memberships[0]?.role ?? 'OWNER';

    const tokens = await this.issueTokens(user.id, orgId, role, meta);
    return { ...tokens, onboarded: user.memberships.length > 0 };
  }

  async issueTokens(
    userId: string,
    organizationId: string,
    role: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const payload = { sub: userId, org: organizationId, role };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: Number(this.config.get('JWT_ACCESS_TTL', 900)),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: Number(this.config.get('JWT_REFRESH_TTL', 2592000)),
    });

    await this.prisma.session.create({
      data: {
        userId,
        refreshHash: await bcrypt.hash(refreshToken, 10),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(
          Date.now() + Number(this.config.get('JWT_REFRESH_TTL', 2592000)) * 1000,
        ),
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string; org: string; role: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Невалидный refresh-токен');
    }

    const sessions = await this.prisma.session.findMany({
      where: { userId: payload.sub, revokedAt: null },
    });
    const match = await Promise.all(
      sessions.map((s) => bcrypt.compare(refreshToken, s.refreshHash)),
    );
    if (!match.some(Boolean)) throw new UnauthorizedException();

    return this.issueTokens(payload.sub, payload.org, payload.role, {});
  }
}
