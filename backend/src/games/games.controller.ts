import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { GamesService } from './games.service';
import { UploadsService } from '../admin/uploads.service';

@Controller('games')
export class GamesController {
  constructor(
    private games: GamesService,
    private uploads: UploadsService,
  ) {}

  // Hardcoded to the games folder, never caller-supplied — same
  // reasoning as the products/reviews/supplements upload endpoints.
  @Get('upload-signature')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.LOYALTY)
  getUploadSignature() {
    return this.uploads.getUploadSignature('protein-panda/games');
  }

  @Get()
  list() {
    return this.games.listGames();
  }

  @Get('leaderboard')
  leaderboard() {
    return this.games.getLeaderboard();
  }

  @Get('leaderboard/gyms')
  gymLeaderboard() {
    return this.games.getGymLeaderboard();
  }

  @Get('my-attempts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  myAttempts(@Req() req: any) {
    return this.games.myRecentAttempts(req.user.customerId);
  }

  @Post('attempts')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN) // staff-operated device logs the result
  @Departments(StaffDepartment.LOYALTY)
  logAttempt(@Req() req: any, @Body() body: any) {
    return this.games.logAttempt({ ...body, loggedByStaffId: req.user.userId });
  }

  // ---- Full challenge system (Pay & Play) ----

  @Get('my-challenges')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  myChallengeHistory(@Req() req: any) {
    return this.games.myChallengeHistory(req.user.customerId);
  }

  @Post('challenges')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  createChallenge(@Req() req: any, @Body('gameId') gameId: string) {
    return this.games.createChallengeAttempt(req.user.customerId, gameId);
  }

  @Post('challenges/:id/confirm-payment')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.LOYALTY)
  confirmChallengePayment(@Param('id') id: string) {
    return this.games.confirmChallengePayment(id);
  }

  @Patch('challenges/:id/result')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.LOYALTY)
  recordChallengeResult(@Req() req: any, @Param('id') id: string, @Body() body: { resultMetric: number; purchaseAmountRs: number }) {
    return this.games.recordChallengeResult(id, body.resultMetric, body.purchaseAmountRs, req.user.userId);
  }

  @Patch('challenges/:id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.LOYALTY)
  verifyChallengeAttempt(@Req() req: any, @Param('id') id: string) {
    return this.games.verifyChallengeAttempt(id, req.user.userId);
  }

  @Get('challenges/dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.LOYALTY)
  challengeDashboard() {
    return this.games.challengeDashboard();
  }
}
