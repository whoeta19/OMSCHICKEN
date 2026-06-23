import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentXmlService } from './document-xml.service';
import { DocumentPdfService } from './document-pdf.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentXmlService, DocumentPdfService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
