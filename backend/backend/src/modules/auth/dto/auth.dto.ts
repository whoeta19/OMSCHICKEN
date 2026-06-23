import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AuthProvider } from '@prisma/client';

export class ProviderLoginDto {
  @IsEnum(AuthProvider)
  provider: AuthProvider;

  @IsString()
  sub: string;

  @IsOptional() @IsString()
  email?: string;

  @IsOptional() @IsString()
  fullName?: string;

  @IsOptional() @IsString()
  ecpThumbprint?: string;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}
