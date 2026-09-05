const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * Fetches a PDF (or any binary file) with auth, then triggers a browser
 * download/open — separate from request() above since that always calls
 * res.json(), which would corrupt binary data. Opens in a new tab rather
 * than forcing a download so it's viewable/printable immediately, matching
 * how the backend sets Content-Disposition: inline.
 */
async function downloadFile(path: string, filename: string) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Failed to load PDF: ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function request(path: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pp_token') : null;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      // Only declare a JSON content-type when there's actually a body
      // to describe — a GET request has no body at all, and declaring
      // `Content-Type: application/json` on one anyway made Fastify's
      // strict body parser reject it outright ("Body cannot be empty
      // when content-type is set to 'application/json'"), breaking
      // every GET request through this helper. This went undetected
      // all session because every boot-test check used curl, which
      // was never set up to send this header on GET calls the way a
      // real browser's fetch() here always was — found only once a
      // real person used a real browser against a real deployment.
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    // A 401 means the session token is invalid or stale (e.g. the account
    // it points to no longer exists — this happens after a database
    // reset during development). Clear it so the app doesn't keep
    // silently sending a dead token; the person just needs to log in again.
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('pp_token');
      localStorage.removeItem('pp_role');
      throw new Error('Your session has expired. Please log in again.');
    }

    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  requestOtp: (identifier: string) => request('/auth/otp/request', { method: 'POST', body: JSON.stringify({ identifier }) }),
  verifyOtp: (identifier: string, code: string, name?: string, gymName?: string, referredByCode?: string) =>
    request('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ identifier, code, name, gymName, referredByCode }) }),
  verifyGoogleToken: (idToken: string) => request('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) }),
  getDashboard: () => request('/customers/me/dashboard'),
  myNotifications: () => request('/notifications'),
  unreadNotificationCount: () => request('/notifications/unread-count'),
  markNotificationRead: (id: string) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'PATCH' }),
  updateMyProfile: (payload: unknown) => request('/customers/me/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  exportMyData: () => request('/customers/me/export'),
  deleteMyAccount: () => request('/customers/me/delete', { method: 'POST' }),
  requestContactChange: (newIdentifier: string) =>
    request('/customers/me/contact-change/request', { method: 'POST', body: JSON.stringify({ newIdentifier }) }),
  confirmContactChange: (newIdentifier: string, code: string) =>
    request('/customers/me/contact-change/confirm', { method: 'POST', body: JSON.stringify({ newIdentifier, code }) }),
  listProducts: (category?: string) => request(`/products${category ? `?category=${category}` : ''}`),
  createOrder: (payload: unknown) => request('/orders', { method: 'POST', body: JSON.stringify(payload) }),
  myOrders: (cursor?: string) => request(`/orders/mine${cursor ? `?cursor=${cursor}` : ''}`),
  getOrder: (orderId: string) => request(`/orders/${orderId}`),
  cancelMyOrder: (orderId: string, reason: string) =>
    request(`/orders/${orderId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getInvoice: (orderId: string) => request(`/orders/${orderId}/invoice`),
  resendInvoice: (orderId: string) => request(`/orders/${orderId}/invoice/resend`, { method: 'POST' }),

  // Payments
  createRazorpayOrder: (orderId: string) => request(`/payments/orders/${orderId}/razorpay`, { method: 'POST' }),
  verifyPayment: (payload: unknown) => request('/payments/verify', { method: 'POST', body: JSON.stringify(payload) }),
  getLeaderboard: () => request('/games/leaderboard'),
  getGymLeaderboard: () => request('/games/leaderboard/gyms'),
  listGames: () => request('/games'),
  myGameAttempts: () => request('/games/my-attempts'),
  listRewards: () => request('/rewards'),
  redeemReward: (rewardId: string) => request('/rewards/redeem', { method: 'POST', body: JSON.stringify({ rewardId }) }),
  myRedemptions: () => request('/rewards/my-redemptions'),
  downloadRedemptionReceipt: (redemptionId: string) =>
    downloadFile(`/rewards/redemptions/${redemptionId}/receipt.pdf`, `reward-voucher-${redemptionId.slice(0, 8)}.pdf`),

  // Admin
  adminOverview: () => request('/admin/overview/today'),
  adminMyDashboard: () => request('/admin/my-dashboard'),
  adminLowStock: () => request('/admin/inventory/low-stock'),
  adminInventory: () => request('/admin/inventory'),
  adminStockMovements: () => request('/admin/inventory/movements'),

  // POS
  posSearchCustomers: (q: string) => request(`/admin/pos/customers?q=${encodeURIComponent(q)}`),
  posCreateWalkIn: (name: string, identifier: string) =>
    request('/admin/pos/customers', { method: 'POST', body: JSON.stringify({ name, identifier }) }),
  posCreateSale: (payload: unknown) => request('/admin/pos/orders', { method: 'POST', body: JSON.stringify(payload) }),
  posAvailableRedemptions: (customerId: string) => request(`/admin/pos/customers/${customerId}/redemptions`),
  adminOrders: (status?: string) => request(`/admin/orders${status ? `?status=${status}` : ''}`),
  adminDownloadInvoicePdf: (orderId: string, orderNumber?: string) =>
    downloadFile(`/admin/orders/${orderId}/invoice.pdf`, `receipt-${orderNumber ?? orderId.slice(0, 8)}.pdf`),
  adminKitchenQueue: () => request('/admin/kitchen-queue'),
  adminUpdateOrderStatus: (orderId: string, status: string) =>
    request(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  adminCollectCash: (orderId: string) => request(`/admin/orders/${orderId}/collect-cash`, { method: 'PATCH' }),
  adminCancelOrder: (orderId: string, reason: string) =>
    request(`/admin/orders/${orderId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminRefundOrder: (orderId: string, amountRs: number, reason: string, method?: 'CASH' | 'RAZORPAY' | 'WALLET') =>
    request(`/admin/orders/${orderId}/refund`, { method: 'POST', body: JSON.stringify({ amountRs, reason, method }) }),
  adminOrderRefunds: (orderId: string) => request(`/admin/orders/${orderId}/refunds`),
  adminAllRefunds: () => request('/admin/refunds'),
  adminAiSafetyFlags: () => request('/admin/ai-safety-flags'),

  // Support tickets (customer)
  myTickets: () => request('/support-tickets'),
  createTicket: (subject: string, body: string, orderId?: string) =>
    request('/support-tickets', { method: 'POST', body: JSON.stringify({ subject, body, orderId }) }),
  getTicket: (id: string) => request(`/support-tickets/${id}`),
  replyToTicket: (id: string, body: string) =>
    request(`/support-tickets/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),

  // Support tickets (admin)
  adminTickets: (status?: string) => request(`/admin/support-tickets${status ? `?status=${status}` : ''}`),
  adminGetTicket: (id: string) => request(`/admin/support-tickets/${id}`),
  adminReplyToTicket: (id: string, body: string) =>
    request(`/admin/support-tickets/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),
  adminUpdateTicketStatus: (id: string, status: string) =>
    request(`/admin/support-tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  adminStaffShifts: (dateFrom?: string, dateTo?: string) =>
    request(`/admin/staff-shifts${dateFrom ? `?dateFrom=${dateFrom}&dateTo=${dateTo}` : ''}`),

  // Staff shifts (self-service, admin + delivery)
  staffClockIn: () => request('/staff-shifts/clock-in', { method: 'POST' }),
  staffClockOut: (note?: string) => request('/staff-shifts/clock-out', { method: 'POST', body: JSON.stringify({ note }) }),
  staffCurrentShift: () => request('/staff-shifts/current'),
  staffMyShifts: () => request('/staff-shifts/mine'),
  adminBroadcastAnnouncement: (title: string, body: string) =>
    request('/admin/announcements', { method: 'POST', body: JSON.stringify({ title, body }) }),
  adminAnnouncementHistory: () => request('/admin/announcements'),

  // Cash reconciliation
  adminCashCurrent: () => request('/admin/cash/current'),
  adminCashOpen: (openingCashRs: number) => request('/admin/cash/open', { method: 'POST', body: JSON.stringify({ openingCashRs }) }),
  adminCashExpense: (shiftId: string, amountRs: number, note: string) =>
    request('/admin/cash/expense', { method: 'POST', body: JSON.stringify({ shiftId, amountRs, note }) }),
  adminCashClose: (shiftId: string, closingCashRs: number) =>
    request('/admin/cash/close', { method: 'POST', body: JSON.stringify({ shiftId, closingCashRs }) }),
  adminCashShifts: () => request('/admin/cash/shifts'),
  adminCashShiftDetail: (id: string) => request(`/admin/cash/shifts/${id}`),
  adminConfirmCashRefund: (refundId: string) => request(`/admin/refunds/${refundId}/confirm-cash`, { method: 'PATCH' }),
  adminCustomers: (search?: string) => request(`/admin/customers${search ? `?search=${search}` : ''}`),
  adminProducts: () => request('/admin/products'),
  adminProductDetail: (id: string) => request(`/admin/products/${id}`),
  adminCategories: () => request('/admin/categories'),
  adminCreateCategory: (payload: unknown) => request('/admin/categories', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateCategory: (id: string, payload: unknown) =>
    request(`/admin/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminCreateProduct: (payload: unknown) => request('/admin/products', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateProduct: (id: string, payload: unknown) =>
    request(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminGetUploadSignature: () => request('/admin/uploads/signature'),
  myAddresses: () => request('/addresses'),
  createAddress: (payload: unknown) => request('/addresses', { method: 'POST', body: JSON.stringify(payload) }),
  updateAddress: (id: string, payload: unknown) => request(`/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAddress: (id: string) => request(`/addresses/${id}`, { method: 'DELETE' }),
  adminSetCustomerActive: (id: string, isActive: boolean) => request(`/admin/customers/${id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  storeOpsChecklistItems: (type: 'OPENING' | 'CLOSING') => request(`/admin/store-operations/checklist-items?type=${type}`),
  storeOpsSubmitLog: (type: 'OPENING' | 'CLOSING', entries: unknown[]) =>
    request('/admin/store-operations/checklist-logs', { method: 'POST', body: JSON.stringify({ type, entries }) }),
  storeOpsTodayStatus: () => request('/admin/store-operations/today-status'),
  storeOpsCloseBusinessDay: () => request('/admin/store-operations/close-business-day', { method: 'POST' }),
  adminListDeliveryZones: () => request('/shop/delivery-zones'),
  adminCreateDeliveryZone: (payload: { name: string; maxDistanceKm: number; feeRs: number; estimatedMinutes?: number }) =>
    request('/shop/delivery-zones', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateDeliveryZone: (id: string, payload: unknown) => request(`/shop/delivery-zones/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminGetBusinessRules: () => request('/admin/business-rules'),
  adminUpdateBusinessRules: (payload: unknown) => request('/admin/business-rules', { method: 'PATCH', body: JSON.stringify(payload) }),
  adminDeleteDeliveryZone: (id: string) => request(`/shop/delivery-zones/${id}`, { method: 'DELETE' }),
  getDeliveryFeeQuote: (lat: number, lng: number) => request(`/shop/delivery-fee-quote?lat=${lat}&lng=${lng}`),
  adminListExpenses: (params?: { category?: string; dateFrom?: string; dateTo?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return request(`/admin/expenses${qs ? `?${qs}` : ''}`);
  },
  adminExpenseSummary: (dateFrom: string, dateTo: string) => request(`/admin/expenses/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`),
  adminRecordExpense: (payload: unknown) => request('/admin/expenses', { method: 'POST', body: JSON.stringify(payload) }),
  adminDeleteExpense: (id: string) => request(`/admin/expenses/${id}`, { method: 'DELETE' }),
  adminReconciliation: (dateFrom: string, dateTo: string) => request(`/admin/cash/reconciliation?dateFrom=${dateFrom}&dateTo=${dateTo}`),
  adminGetSegment: (type: string) => request(`/admin/segments?type=${type}`),
  adminListCampaigns: () => request('/admin/campaigns'),
  adminSendCampaign: (payload: { name: string; segmentType: string; title: string; body: string }) =>
    request('/admin/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  adminAuditLog: (params?: { entityType?: string; actorUserId?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return request(`/admin/audit-log${qs ? `?${qs}` : ''}`);
  },
  myWalletTransactions: () => request('/customers/me/wallet-transactions'),
  mySessions: () => request('/auth/sessions'),
  revokeSession: (id: string) => request(`/auth/sessions/${id}`, { method: 'DELETE' }),
  getVapidPublicKey: () => request('/notifications/push/vapid-public-key'),
  subscribePush: (subscription: unknown) => request('/notifications/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) }),
  unsubscribePush: (endpoint: string) => request('/notifications/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  myFavourites: () => request('/favourites'),
  myFavouriteIds: () => request('/favourites/ids'),
  addFavourite: (productId: string) => request(`/favourites/${productId}`, { method: 'POST' }),
  removeFavourite: (productId: string) => request(`/favourites/${productId}`, { method: 'DELETE' }),
  adminAllergens: () => request('/admin/allergens'),
  adminCreateAllergen: (name: string) => request('/admin/allergens', { method: 'POST', body: JSON.stringify({ name }) }),
  adminSetProductAllergens: (productId: string, allergenIds: string[]) =>
    request(`/admin/products/${productId}/allergens`, { method: 'PATCH', body: JSON.stringify({ allergenIds }) }),
  adminCreateAddon: (productId: string, payload: unknown) =>
    request(`/admin/products/${productId}/addons`, { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateAddon: (addonId: string, payload: unknown) =>
    request(`/admin/addons/${addonId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminDeleteAddon: (addonId: string) => request(`/admin/addons/${addonId}`, { method: 'DELETE' }),
  adminIngredients: () => request('/admin/ingredients'),

  // Suppliers & purchases
  adminSuppliers: () => request('/admin/suppliers'),
  adminCreateSupplier: (payload: unknown) => request('/admin/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateSupplier: (id: string, payload: unknown) =>
    request(`/admin/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminPurchases: () => request('/admin/suppliers/purchases/all'),
  adminCreatePurchase: (payload: unknown) => request('/admin/suppliers/purchases', { method: 'POST', body: JSON.stringify(payload) }),
  adminCreatePurchaseRequest: (payload: { ingredientId: string; requestedQty: number; note?: string }) =>
    request('/admin/suppliers/purchase-requests', { method: 'POST', body: JSON.stringify(payload) }),
  adminListPurchaseRequests: (status?: string) => request(`/admin/suppliers/purchase-requests${status ? `?status=${status}` : ''}`),
  adminDecidePurchaseRequest: (id: string, decision: 'APPROVED' | 'REJECTED', rejectionReason?: string) =>
    request(`/admin/suppliers/purchase-requests/${id}/decide`, { method: 'PATCH', body: JSON.stringify({ decision, rejectionReason }) }),

  // Product costing
  adminCostingSummary: () => request('/admin/costing/summary'),
  adminProductCosting: (productId: string) => request(`/admin/products/${productId}/costing`),

  // Food safety
  adminFoodSafetyItems: () => request('/admin/food-safety/checklist-items'),
  adminCreateFoodSafetyItem: (payload: unknown) => request('/admin/food-safety/checklist-items', { method: 'POST', body: JSON.stringify(payload) }),
  adminSubmitFoodSafetyLog: (payload: unknown) => request('/admin/food-safety/logs', { method: 'POST', body: JSON.stringify(payload) }),
  adminFoodSafetyLogs: () => request('/admin/food-safety/logs'),
  adminFoodSafetyTodayStatus: (shiftLabel?: string) =>
    request(`/admin/food-safety/today-status${shiftLabel ? `?shiftLabel=${shiftLabel}` : ''}`),

  adminSetProductIngredient: (productId: string, ingredientId: string, quantity: number) =>
    request(`/admin/products/${productId}/ingredients/${ingredientId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) }),
  adminRemoveProductIngredient: (productId: string, ingredientId: string) =>
    request(`/admin/products/${productId}/ingredients/${ingredientId}`, { method: 'DELETE' }),

  // Rewards
  adminRewards: () => request('/admin/rewards'),
  adminCreateReward: (payload: unknown) => request('/admin/rewards', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateReward: (id: string, payload: unknown) =>
    request(`/admin/rewards/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Coupons
  adminCoupons: () => request('/admin/coupons'),
  adminCreateCoupon: (payload: unknown) => request('/admin/coupons', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateCoupon: (id: string, payload: unknown) =>
    request(`/admin/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Games & Levels
  adminGames: () => request('/admin/games'),
  adminCreateGame: (payload: unknown) => request('/admin/games', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateGame: (id: string, payload: unknown) =>
    request(`/admin/games/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminCreateGameLevel: (gameId: string, payload: unknown) =>
    request(`/admin/games/${gameId}/levels`, { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateGameLevel: (levelId: string, payload: unknown) =>
    request(`/admin/game-levels/${levelId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminDeleteGameLevel: (levelId: string) => request(`/admin/game-levels/${levelId}`, { method: 'DELETE' }),

  // Delivery
  deliveryMyOrders: () => request('/delivery/my-orders'),
  deliveryMe: () => request('/delivery/me'),
  deliveryUpdateStatus: (deliveryOrderId: string, action: string, otp?: string) =>
    request(`/delivery/${deliveryOrderId}/status`, { method: 'PATCH', body: JSON.stringify({ status: action, otp }) }),
  deliveryReportFailure: (deliveryOrderId: string, reason: string, note?: string) =>
    request(`/delivery/${deliveryOrderId}/failure`, { method: 'PATCH', body: JSON.stringify({ reason, note }) }),
  deliverySetDuty: (isOnDuty: boolean) => request('/delivery/duty', { method: 'PATCH', body: JSON.stringify({ isOnDuty }) }),
  deliveryUpdateLocation: (deliveryOrderId: string, lat: number, lng: number) =>
    request(`/delivery/${deliveryOrderId}/location`, { method: 'PATCH', body: JSON.stringify({ lat, lng }) }),

  // Shop status
  getShopStatus: () => request('/shop/status'),
  adminUpdateShopStatus: (payload: unknown) => request('/shop/status', { method: 'PATCH', body: JSON.stringify(payload) }),
  adminToggleShop: () => request('/shop/toggle', { method: 'PATCH' }),
  adminAnalytics: (range: 'today' | 'week' | 'month') => request(`/admin/analytics?range=${range}`),
  adminAvailableRiders: () => request('/admin/delivery-personnel/available'),
  adminAssignDelivery: (orderId: string, deliveryPersonId: string) =>
    request(`/admin/orders/${orderId}/assign-delivery`, { method: 'PATCH', body: JSON.stringify({ deliveryPersonId }) }),
  adminAssignBestRider: (orderId: string) => request(`/admin/orders/${orderId}/assign-best-rider`, { method: 'PATCH' }),
  adminCustomerDetail: (id: string) => request(`/admin/customers/${id}`),
  adminCreateIngredient: (payload: unknown) => request('/admin/inventory/ingredients', { method: 'POST', body: JSON.stringify(payload) }),
  adminRestock: (inventoryItemId: string, amount: number, note?: string, batchDetails?: { batchNumber?: string; expiryDate?: string; supplierName?: string }) =>
    request(`/admin/inventory/${inventoryItemId}/restock`, { method: 'PATCH', body: JSON.stringify({ amount, note, ...batchDetails }) }),
  adminExpiringBatches: (days = 3) => request(`/admin/inventory/expiring?days=${days}`),
  adminBatchesForIngredient: (ingredientId: string) => request(`/admin/ingredients/${ingredientId}/batches`),
  adminRecordWastage: (batchId: string, quantity: number, reason: string) =>
    request(`/admin/inventory/batches/${batchId}/wastage`, { method: 'POST', body: JSON.stringify({ quantity, reason }) }),
  adminDeliveryPersonnel: () => request('/admin/delivery-personnel'),

  // Staff accounts
  adminListStaff: () => request('/admin/staff'),
  adminCreateStaff: (payload: unknown) => request('/admin/staff', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateStaff: (userId: string, payload: unknown) =>
    request(`/admin/staff/${userId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminSetStaffActive: (userId: string, isActive: boolean) =>
    request(`/admin/staff/${userId}/active`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),

  // AI Nutrition Assistant
  aiChat: (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    request('/ai/chat', { method: 'POST', body: JSON.stringify({ messages }) }),

  // Achievements
  myAchievements: () => request('/achievements/mine'),
  getMonthlyReport: (month?: string) => request(`/customers/me/monthly-report${month ? `?month=${month}` : ''}`),
  downloadInvoicePdf: (orderId: string, orderNumber?: string) =>
    downloadFile(`/orders/${orderId}/invoice.pdf`, `invoice-${orderNumber ?? orderId.slice(0, 8)}.pdf`),

  // Memberships
  createMembership: (payload: unknown) => request('/memberships', { method: 'POST', body: JSON.stringify(payload) }),
  myMemberships: () => request('/memberships/mine'),
  pauseMembership: (id: string) => request(`/memberships/${id}/pause`, { method: 'PATCH' }),
  resumeMembership: (id: string) => request(`/memberships/${id}/resume`, { method: 'PATCH' }),
  cancelMembership: (id: string) => request(`/memberships/${id}/cancel`, { method: 'PATCH' }),
  skipNextMembership: (id: string) => request(`/memberships/${id}/skip-next`, { method: 'PATCH' }),
  updateMembershipTime: (id: string, scheduledTime: string) =>
    request(`/memberships/${id}/scheduled-time`, { method: 'PATCH', body: JSON.stringify({ scheduledTime }) }),

  // Reviews & delivery ratings
  listProductReviews: (productId: string) => request(`/products/${productId}/reviews`),
  addProductReview: (productId: string, rating: number, comment?: string, photoUrls?: string[]) =>
    request(`/products/${productId}/reviews`, { method: 'POST', body: JSON.stringify({ rating, comment, photoUrls }) }),
  tipDeliveryPerson: (orderId: string, amountRs: number) => request(`/orders/${orderId}/tip`, { method: 'POST', body: JSON.stringify({ amountRs }) }),
  setDeliveryPreference: (orderId: string, preference: 'DONT_RING_BELL' | 'LEAVE_AT_DOOR') =>
    request(`/orders/${orderId}/delivery-preference`, { method: 'POST', body: JSON.stringify({ preference }) }),
  getReviewUploadSignature: () => request('/products/reviews/upload-signature'),
  rateDelivery: (orderId: string, rating: number, tags: string[], comment?: string) =>
    request(`/orders/${orderId}/delivery-rating`, { method: 'POST', body: JSON.stringify({ rating, tags, comment }) }),
};
