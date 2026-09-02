import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DeliveryService } from './delivery.service';

@Controller('delivery')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.DELIVERY)
export class DeliveryController {
  constructor(private delivery: DeliveryService) {}

  @Get('my-orders')
  myOrders(@Req() req: any) {
    return this.delivery.myAssignedOrders(req.user.deliveryPersonId);
  }

  @Get('me')
  me(@Req() req: any) {
    return this.delivery.getProfile(req.user.deliveryPersonId);
  }

  @Patch(':deliveryOrderId/status')
  updateStatus(
    @Req() req: any,
    @Param('deliveryOrderId') deliveryOrderId: string,
    @Body() body: { status: string; otp?: string },
  ) {
    return this.delivery.updateDeliveryStatus(req.user.deliveryPersonId, deliveryOrderId, body.status, body.otp);
  }

  @Patch(':deliveryOrderId/failure')
  reportFailure(
    @Req() req: any,
    @Param('deliveryOrderId') deliveryOrderId: string,
    @Body() body: { reason: string; note?: string },
  ) {
    return this.delivery.reportDeliveryFailure(req.user.deliveryPersonId, deliveryOrderId, body.reason, body.note);
  }

  @Patch('duty')
  setDuty(@Req() req: any, @Body('isOnDuty') isOnDuty: boolean) {
    return this.delivery.setDutyStatus(req.user.deliveryPersonId, isOnDuty);
  }

  @Patch(':deliveryOrderId/location')
  updateLocation(
    @Req() req: any,
    @Param('deliveryOrderId') deliveryOrderId: string,
    @Body() body: { lat: number; lng: number },
  ) {
    return this.delivery.updateLiveLocation(req.user.deliveryPersonId, deliveryOrderId, body.lat, body.lng);
  }
}
