import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { OwnerOnlyGuard } from '../common/owner-only.guard';
import { AdminService } from './admin.service';
import { PdfService } from '../pdf/pdf.service';
import { UploadsService } from './uploads.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private admin: AdminService,
    private pdf: PdfService,
    private uploads: UploadsService,
  ) {}

  @Get('uploads/signature')
  @Departments(StaffDepartment.SALES)
  getUploadSignature() {
    return this.uploads.getUploadSignature();
  }

  @Get('orders/:id/invoice.pdf')
  @Departments(StaffDepartment.SALES)
  async invoicePdf(@Param('id') id: string, @Res() res: FastifyReply) {
    const buffer = await this.pdf.generateOrderInvoicePdf(id);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="invoice-${id.slice(0, 8)}.pdf"`)
      .send(buffer);
  }

  // Deliberately no @Departments() — the daily overview is a shared
  // home base every department lands on, same as the "Overview"
  // sidebar link every admin sees regardless of department.
  @Get('overview/today')
  todayOverview() {
    return this.admin.getTodayOverview();
  }

  @Get('analytics')
  @Departments(StaffDepartment.FINANCE_MARKETING)
  analytics(@Query('range') range?: 'today' | 'week' | 'month') {
    return this.admin.getPosAnalytics(range);
  }

  @Get('inventory/low-stock')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  lowStock() {
    return this.admin.lowStockItems();
  }

  @Get('inventory')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  inventory() {
    return this.admin.listInventory();
  }

  @Get('inventory/movements')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  stockMovements() {
    return this.admin.listStockMovements();
  }

  @Get('inventory/expiring')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  expiringBatches(@Query('days') days?: string) {
    return this.admin.listExpiringBatches(days ? Number(days) : undefined);
  }

  @Get('ingredients/:id/batches')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  batchesForIngredient(@Param('id') id: string) {
    return this.admin.listBatchesForIngredient(id);
  }

  @Post('inventory/ingredients')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  createIngredient(@Body() body: any) {
    return this.admin.createIngredient(body);
  }

  @Patch('inventory/:id/restock')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  restock(
    @Param('id') id: string,
    @Body() body: { amount: number; note?: string; batchNumber?: string; expiryDate?: string; supplierName?: string },
  ) {
    return this.admin.restock(id, body.amount, body.note, {
      batchNumber: body.batchNumber,
      expiryDate: body.expiryDate,
      supplierName: body.supplierName,
    });
  }

  @Post('inventory/batches/:batchId/wastage')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  recordWastage(@Param('batchId') batchId: string, @Body() body: { quantity: number; reason: string }) {
    return this.admin.recordWastage(batchId, body.quantity, body.reason);
  }

  @Get('delivery-personnel')
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  deliveryPersonnel() {
    return this.admin.listDeliveryPersonnel();
  }

  @Get('delivery-personnel/available')
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  availableRiders() {
    return this.admin.listAvailableRiders();
  }

  @Patch('orders/:id/assign-delivery')
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  assignDelivery(@Param('id') id: string, @Body('deliveryPersonId') deliveryPersonId: string) {
    return this.admin.assignDeliveryRider(id, deliveryPersonId);
  }

  @Patch('orders/:id/assign-best-rider')
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  assignBestRider(@Param('id') id: string) {
    return this.admin.autoAssignBestRider(id);
  }

  @Get('orders')
  @Departments(StaffDepartment.SALES)
  orders(@Query('status') status?: string, @Query('cursor') cursor?: string) {
    return this.admin.listOrders({ status, cursor });
  }

  @Get('kitchen-queue')
  @Departments(StaffDepartment.OPERATIONS)
  kitchenQueue() {
    return this.admin.getKitchenQueue();
  }

  @Get('customers')
  @Departments(StaffDepartment.SALES)
  customers(@Query('search') search?: string, @Query('cursor') cursor?: string) {
    return this.admin.listCustomers({ search, cursor });
  }

  @Get('customers/:id')
  @Departments(StaffDepartment.SALES)
  customerDetail(@Param('id') id: string) {
    return this.admin.getCustomerDetail(id);
  }

  @Patch('customers/:id/active')
  @Departments(StaffDepartment.SALES)
  setCustomerActive(@Req() req: any, @Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.admin.setCustomerActive(id, body.isActive, req.user.userId, req.user.role);
  }

  @Patch('orders/:id/collect-cash')
  @Departments(StaffDepartment.SALES)
  collectCash(@Param('id') id: string) {
    return this.admin.collectCashPayment(id);
  }

  @Get('products')
  @Departments(StaffDepartment.SALES)
  products() {
    return this.admin.listAllProducts();
  }

  @Get('products/:id')
  @Departments(StaffDepartment.SALES)
  productDetail(@Param('id') id: string) {
    return this.admin.getProductDetail(id);
  }

  @Get('categories')
  @Departments(StaffDepartment.SALES)
  categories() {
    return this.admin.listCategories();
  }

  @Post('categories')
  @Departments(StaffDepartment.SALES)
  createCategory(@Body() body: { name: string; slug: string }) {
    return this.admin.createCategory(body);
  }

  @Patch('categories/:id')
  @Departments(StaffDepartment.SALES)
  updateCategory(@Param('id') id: string, @Body() body: any) {
    return this.admin.updateCategory(id, body);
  }

  @Post('products')
  @Departments(StaffDepartment.SALES)
  createProduct(@Body() body: any) {
    return this.admin.createProduct(body);
  }

  @Patch('products/:id')
  @Departments(StaffDepartment.SALES)
  updateProduct(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.admin.updateProduct(id, body, req.user.userId, req.user.role);
  }

  @Get('allergens')
  @Departments(StaffDepartment.SALES)
  allergens() {
    return this.admin.listAllergens();
  }

  @Post('allergens')
  @Departments(StaffDepartment.SALES)
  createAllergen(@Body('name') name: string) {
    return this.admin.createAllergen(name);
  }

  @Patch('products/:id/allergens')
  @Departments(StaffDepartment.SALES)
  setProductAllergens(@Param('id') id: string, @Body('allergenIds') allergenIds: string[]) {
    return this.admin.setProductAllergens(id, allergenIds);
  }

  @Post('products/:id/addons')
  @Departments(StaffDepartment.SALES)
  createAddon(@Param('id') id: string, @Body() body: any) {
    return this.admin.createProductAddon(id, body);
  }

  @Patch('addons/:addonId')
  @Departments(StaffDepartment.SALES)
  updateAddon(@Param('addonId') addonId: string, @Body() body: any) {
    return this.admin.updateProductAddon(addonId, body);
  }

  @Delete('addons/:addonId')
  @Departments(StaffDepartment.SALES)
  deleteAddon(@Param('addonId') addonId: string) {
    return this.admin.deleteProductAddon(addonId);
  }

  @Get('ingredients')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  ingredients() {
    return this.admin.listIngredientsPlain();
  }

  @Patch('products/:id/ingredients/:ingredientId')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  setProductIngredient(
    @Param('id') id: string,
    @Param('ingredientId') ingredientId: string,
    @Body('quantity') quantity: number,
  ) {
    return this.admin.setProductIngredient(id, ingredientId, quantity);
  }

  @Delete('products/:id/ingredients/:ingredientId')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  removeProductIngredient(@Param('id') id: string, @Param('ingredientId') ingredientId: string) {
    return this.admin.removeProductIngredient(id, ingredientId);
  }

  // No @Departments() — AI safety flags are owner-level by nature
  // (see the "AI Safety" sidebar item also being owner-only), enforced
  // separately below with OwnerOnlyGuard rather than a department list.
  @Get('ai-safety-flags')
  @UseGuards(OwnerOnlyGuard)
  aiSafetyFlags() {
    return this.admin.listAiSafetyFlags();
  }

  @Get('costing/summary')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  costingSummary() {
    return this.admin.listProductCostingSummary();
  }

  @Get('products/:id/costing')
  @Departments(StaffDepartment.SUPPLY_CHAIN)
  productCosting(@Param('id') id: string) {
    return this.admin.getProductCosting(id);
  }

  @Get('rewards')
  @Departments(StaffDepartment.LOYALTY)
  rewards() {
    return this.admin.listRewards();
  }

  @Post('rewards')
  @Departments(StaffDepartment.LOYALTY)
  createReward(@Body() body: any) {
    return this.admin.createReward(body);
  }

  @Patch('rewards/:id')
  @Departments(StaffDepartment.LOYALTY)
  updateReward(@Param('id') id: string, @Body() body: any) {
    return this.admin.updateReward(id, body);
  }

  @Get('coupons')
  @Departments(StaffDepartment.SALES)
  coupons() {
    return this.admin.listCoupons();
  }

  @Post('coupons')
  @Departments(StaffDepartment.SALES)
  createCoupon(@Body() body: any) {
    return this.admin.createCoupon(body);
  }

  @Patch('coupons/:id')
  @Departments(StaffDepartment.SALES)
  updateCoupon(@Param('id') id: string, @Body() body: any) {
    return this.admin.updateCoupon(id, body);
  }

  @Get('games')
  @Departments(StaffDepartment.LOYALTY)
  games() {
    return this.admin.listGames();
  }

  @Post('games')
  @Departments(StaffDepartment.LOYALTY)
  createGame(@Body() body: { name: string; description?: string }) {
    return this.admin.createGame(body);
  }

  @Patch('games/:id')
  @Departments(StaffDepartment.LOYALTY)
  updateGame(@Param('id') id: string, @Body() body: any) {
    return this.admin.updateGame(id, body);
  }

  @Post('games/:id/levels')
  @Departments(StaffDepartment.LOYALTY)
  createGameLevel(@Param('id') id: string, @Body() body: any) {
    return this.admin.createGameLevel(id, body);
  }

  @Patch('game-levels/:levelId')
  @Departments(StaffDepartment.LOYALTY)
  updateGameLevel(@Param('levelId') levelId: string, @Body() body: any) {
    return this.admin.updateGameLevel(levelId, body);
  }

  @Delete('game-levels/:levelId')
  @Departments(StaffDepartment.LOYALTY)
  deleteGameLevel(@Param('levelId') levelId: string) {
    return this.admin.deleteGameLevel(levelId);
  }
}
