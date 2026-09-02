import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ProductsService } from './products.service';
import { UploadsService } from '../admin/uploads.service';

@Controller('products')
export class ProductsController {
  constructor(
    private products: ProductsService,
    private uploads: UploadsService,
  ) {}

  // Customer-facing, deliberately separate from admin's own
  // /admin/uploads/signature — restricted to the reviews folder only,
  // so a customer's signature can never be used to upload into the
  // admin-only products folder.
  @Get('reviews/upload-signature')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  getReviewUploadSignature() {
    return this.uploads.getUploadSignature('protein-panda/reviews');
  }

  @Get()
  list(@Query('category') category?: string, @Query('cursor') cursor?: string) {
    return this.products.list({ categorySlug: category, cursor });
  }

  @Get(':slug')
  getOne(@Param('slug') slug: string) {
    return this.products.getBySlug(slug);
  }

  @Get(':id/reviews')
  reviews(@Param('id') id: string) {
    return this.products.listReviews(id);
  }

  @Post(':id/reviews')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  addReview(@Req() req: any, @Param('id') id: string, @Body() body: { rating: number; comment?: string; photoUrls?: string[] }) {
    return this.products.addReview(req.user.customerId, id, body.rating, body.comment, body.photoUrls);
  }
}
