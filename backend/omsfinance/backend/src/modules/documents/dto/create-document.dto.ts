import { Type } from 'class-transformer';
import {
  IsArray, IsEnum, IsInt, IsNumber, IsObject, IsOptional,
  IsString, ValidateNested, Min,
} from 'class-validator';
import { DocumentType } from '@prisma/client';

export class DocumentItemDto {
  @IsString() name: string;
  @IsOptional() @IsString() unit?: string;
  @IsNumber() @Min(0) quantity: number;
  @IsNumber() @Min(0) price: number;
  @IsInt() vatRate: number; // 0 / 10 / 20
}

export class CreateDocumentDto {
  @IsEnum(DocumentType) type: DocumentType;
  @IsString() number: string;
  @IsString() issueDate: string; // ISO

  @IsOptional() @IsString() counterpartyId?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => DocumentItemDto)
  items: DocumentItemDto[];

  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
