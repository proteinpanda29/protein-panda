import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { NotificationCenterService } from './notification-center.service';
import { PushNotificationService } from './push-notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class NotificationCenterController {
  constructor(
    private notifications: NotificationCenterService,
    private push: PushNotificationService,
  ) {}

  @Get()
  list(@Req() req: any) {
    return this.notifications.listForCustomer(req.user.customerId);
  }

  @Get('unread-count')
  unreadCount(@Req() req: any) {
    return this.notifications.unreadCount(req.user.customerId);
  }

  @Patch(':id/read')
  markAsRead(@Req() req: any, @Param('id') id: string) {
    return this.notifications.markAsRead(req.user.customerId, id);
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: any) {
    return this.notifications.markAllAsRead(req.user.customerId);
  }

  // Public info (the VAPID key is meant to be sent to the browser —
  // it's the public half of the pair, not a secret), but still behind
  // the same customer auth as everything else here since there's no
  // reason a logged-out visitor needs it.
  @Get('push/vapid-public-key')
  vapidPublicKey() {
    return { key: this.push.getPublicKey() };
  }

  @Post('push/subscribe')
  subscribe(@Req() req: any, @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return this.push.subscribe(req.user.customerId, body);
  }

  @Delete('push/subscribe')
  unsubscribe(@Body() body: { endpoint: string }) {
    return this.push.unsubscribe(body.endpoint);
  }
}

@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.FINANCE_MARKETING)
export class AnnouncementsController {
  constructor(private notifications: NotificationCenterService) {}

  @Post()
  broadcast(@Req() req: any, @Body() body: { title: string; body: string }) {
    return this.notifications.broadcastAnnouncement(req.user.userId, body.title, body.body);
  }

  @Get()
  history() {
    return this.notifications.listAnnouncementHistory();
  }
}
