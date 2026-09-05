import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private games: GamesService) {}

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
}
