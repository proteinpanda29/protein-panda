import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  providers: [PdfService, PrismaService],
  exports: [PdfService],
})
export class PdfModule {}
