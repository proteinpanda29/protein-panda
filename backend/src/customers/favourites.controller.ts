import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { FavouritesService } from './favourites.service';

@Controller('favourites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class FavouritesController {
  constructor(private favourites: FavouritesService) {}

  @Get()
  list(@Req() req: any) {
    return this.favourites.list(req.user.customerId);
  }

  // A lightweight companion to list() above — just the ids, for a page
  // like the menu that needs to know "is this heart filled or not" for
  // every product shown, without fetching each favourited product's
  // full details a second time.
  @Get('ids')
  listIds(@Req() req: any) {
    return this.favourites.listFavouritedProductIds(req.user.customerId);
  }

  @Post(':productId')
  add(@Req() req: any, @Param('productId') productId: string) {
    return this.favourites.add(req.user.customerId, productId);
  }

  @Delete(':productId')
  remove(@Req() req: any, @Param('productId') productId: string) {
    return this.favourites.remove(req.user.customerId, productId);
  }
}
