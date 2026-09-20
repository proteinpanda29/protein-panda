import { PrismaClient, RewardType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const shakes = await prisma.productCategory.upsert({
    where: { slug: 'protein-shakes' },
    update: {},
    create: { name: 'Protein Shakes', slug: 'protein-shakes' },
  });

  const dietFood = await prisma.productCategory.upsert({
    where: { slug: 'diet-food' },
    update: {},
    create: { name: 'Diet Food', slug: 'diet-food' },
  });

  const milk = await prisma.allergen.upsert({ where: { name: 'Milk' }, update: {}, create: { name: 'Milk' } });
  await prisma.allergen.upsert({ where: { name: 'Peanut' }, update: {}, create: { name: 'Peanut' } });
  await prisma.allergen.upsert({ where: { name: 'Egg' }, update: {}, create: { name: 'Egg' } });
  await prisma.allergen.upsert({ where: { name: 'Soy' }, update: {}, create: { name: 'Soy' } });

  const chocShake = await prisma.product.upsert({
    where: { slug: 'chocolate-protein-shake' },
    update: {},
    create: {
      categoryId: shakes.id,
      name: 'Custom Protein Shake',
      slug: 'chocolate-protein-shake',
      basePriceRs: 149,
      isVeg: true,
      isCustomisable: true,
      prepTimeMinutes: 5,
      nutrition: {
        create: { calories: 320, proteinG: 30, carbsG: 28, fatG: 9, fibreG: 5 },
      },
      allergens: { create: [{ allergenId: milk.id }] },
      addonOptions: {
        create: [
          // Base — required, single-select
          { group: 'BASE', name: 'Whey Protein', isRequired: true, extraPriceRs: 0, extraProteinG: 24, extraCalories: 120 },
          { group: 'BASE', name: 'Plant Protein', isRequired: true, extraPriceRs: 10, extraProteinG: 20, extraCalories: 110 },
          // Flavour — required, single-select
          { group: 'FLAVOUR', name: 'Chocolate', isRequired: true, extraPriceRs: 0 },
          { group: 'FLAVOUR', name: 'Vanilla', isRequired: true, extraPriceRs: 0 },
          { group: 'FLAVOUR', name: 'Mango', isRequired: true, extraPriceRs: 10 },
          // Liquid — required, single-select
          { group: 'LIQUID', name: 'Milk', isRequired: true, extraPriceRs: 0, extraCalories: 60 },
          { group: 'LIQUID', name: 'Water', isRequired: true, extraPriceRs: 0 },
          // Add-ons — optional, multi-select
          { group: 'ADDON', name: 'Extra Scoop', extraPriceRs: 40, extraProteinG: 20, extraCalories: 90 },
          { group: 'ADDON', name: 'Banana', extraPriceRs: 15, extraProteinG: 1, extraCalories: 100 },
          { group: 'ADDON', name: 'Dates', extraPriceRs: 20, extraProteinG: 0.5, extraCalories: 60 },
          { group: 'ADDON', name: 'Dry Fruits', extraPriceRs: 30, extraProteinG: 2, extraCalories: 80 },
        ],
      },
    },
  });

  const proteinOats = await prisma.product.upsert({
    where: { slug: 'protein-oats' },
    update: {},
    create: {
      categoryId: dietFood.id,
      name: 'Protein Oats',
      slug: 'protein-oats',
      basePriceRs: 129,
      isVeg: true,
      nutrition: { create: { calories: 280, proteinG: 22, carbsG: 35, fatG: 6, fibreG: 7 } },
    },
  });

  // ---- Ingredients + inventory + recipes (powers stock deduction on sale) ----
  const wheyIngredient = await prisma.ingredient.upsert({
    where: { name: 'Whey Protein Powder' },
    update: {},
    create: { name: 'Whey Protein Powder', unit: 'g' },
  });
  const milkIngredient = await prisma.ingredient.upsert({
    where: { name: 'Milk' },
    update: {},
    create: { name: 'Milk', unit: 'ml' },
  });
  const oatsIngredient = await prisma.ingredient.upsert({
    where: { name: 'Rolled Oats' },
    update: {},
    create: { name: 'Rolled Oats', unit: 'g' },
  });

  await prisma.inventoryItem.upsert({
    where: { ingredientId: wheyIngredient.id },
    update: {},
    create: { ingredientId: wheyIngredient.id, quantityOnHand: 5000, reorderLevel: 1000 }, // 5kg on hand
  });
  await prisma.inventoryItem.upsert({
    where: { ingredientId: milkIngredient.id },
    update: {},
    create: { ingredientId: milkIngredient.id, quantityOnHand: 20000, reorderLevel: 5000 }, // 20L on hand
  });
  await prisma.inventoryItem.upsert({
    where: { ingredientId: oatsIngredient.id },
    update: {},
    create: { ingredientId: oatsIngredient.id, quantityOnHand: 3000, reorderLevel: 500 }, // 3kg on hand
  });

  // Seed batches so FEFO deduction and expiry warnings are demonstrable
  // out of the box — milk deliberately expires soon to show the
  // "Expiring Soon" warning on /admin/inventory right away.
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  const laterMonth = new Date();
  laterMonth.setDate(laterMonth.getDate() + 60);

  await prisma.ingredientBatch.createMany({
    data: [
      { ingredientId: wheyIngredient.id, batchNumber: 'WHEY-001', quantityReceived: 5000, quantityRemaining: 5000, expiryDate: laterMonth, supplierName: 'ABC Nutrition Supplies' },
      { ingredientId: milkIngredient.id, batchNumber: 'MILK-001', quantityReceived: 20000, quantityRemaining: 20000, expiryDate: soon, supplierName: 'Local Dairy Co-op' },
      { ingredientId: oatsIngredient.id, batchNumber: 'OATS-001', quantityReceived: 3000, quantityRemaining: 3000, expiryDate: laterMonth, supplierName: 'Wholegrain Traders' },
    ],
    skipDuplicates: true,
  });

  // Recipe: one Custom Protein Shake uses 30g whey + 200ml milk
  await prisma.productIngredient.upsert({
    where: { productId_ingredientId: { productId: chocShake.id, ingredientId: wheyIngredient.id } },
    update: {},
    create: { productId: chocShake.id, ingredientId: wheyIngredient.id, quantity: 30 },
  });
  await prisma.productIngredient.upsert({
    where: { productId_ingredientId: { productId: chocShake.id, ingredientId: milkIngredient.id } },
    update: {},
    create: { productId: chocShake.id, ingredientId: milkIngredient.id, quantity: 200 },
  });
  // Recipe: one Protein Oats uses 50g oats + 150ml milk
  await prisma.productIngredient.upsert({
    where: { productId_ingredientId: { productId: proteinOats.id, ingredientId: oatsIngredient.id } },
    update: {},
    create: { productId: proteinOats.id, ingredientId: oatsIngredient.id, quantity: 50 },
  });
  await prisma.productIngredient.upsert({
    where: { productId_ingredientId: { productId: proteinOats.id, ingredientId: milkIngredient.id } },
    update: {},
    create: { productId: proteinOats.id, ingredientId: milkIngredient.id, quantity: 150 },
  });

  await prisma.streakMilestoneReward.upsert({
    where: { streakDays: 7 },
    update: {},
    create: { streakDays: 7, description: 'Small discount', rewardType: RewardType.DISCOUNT, rewardValue: 20 },
  });
  await prisma.streakMilestoneReward.upsert({
    where: { streakDays: 30 },
    update: {},
    create: { streakDays: 30, description: 'Free shake', rewardType: RewardType.FREE_ITEM },
  });

  const hangingGame = await prisma.game.upsert({
    where: { name: 'Hanging Challenge' },
    update: {},
    create: { name: 'Hanging Challenge', description: 'Hang from the bar as long as you can.' },
  });

  await prisma.gameLevel.upsert({
    where: { gameId_levelNumber: { gameId: hangingGame.id, levelNumber: 1 } },
    update: {},
    create: { gameId: hangingGame.id, levelNumber: 1, levelName: 'Beginner', targetMetric: 20, pointsAward: 20 },
  });

  await prisma.shopSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      isOpen: true,
      opensAt: '07:00',
      closesAt: '22:00',
      contactPhone: '+91 90000 00000',
      contactEmail: 'hello@proteinpanda.in',
      whatsappNumber: '919000000000',
      address: 'Near VIT Main Gate, Vellore, Tamil Nadu',
      mapsUrl: 'https://maps.google.com',
      instagramUrl: 'https://instagram.com/proteinpanda',
      fssaiNumber: '12345678901234', // replace with the real license number before going live
      facebookUrl: 'https://facebook.com/proteinpanda',
    },
  });

  const achievements = [
    { code: 'FIRST_ORDER', name: 'First Order', description: 'Placed your first Protein Panda order', icon: '🥤', pointsReward: 50 },
    { code: 'STREAK_7', name: '7-Day Streak', description: 'Kept a 7-day protein streak going', icon: '🔥', pointsReward: 100 },
    { code: 'STREAK_30', name: '30-Day Streak', description: 'Kept a 30-day protein streak going', icon: '🔥', pointsReward: 400 },
    { code: 'PROTEIN_DAY_100', name: '100g Protein Day', description: 'Hit 100g of protein in a single day', icon: '💪', pointsReward: 50 },
    { code: 'PROTEIN_TOTAL_1000', name: '1,000g Protein Club', description: 'Consumed 1,000g of protein all-time through Protein Panda', icon: '🏋️', pointsReward: 200 },
    { code: 'FIRST_GAME_WIN', name: 'First Game Win', description: 'Won your first in-shop challenge', icon: '🎮', pointsReward: 50 },
    { code: 'GAME_WINS_10', name: '10 Game Wins', description: 'Won 10 in-shop challenges', icon: '🏆', pointsReward: 200 },
    { code: 'ORDERS_10', name: '10 Orders', description: 'Placed 10 orders', icon: '🥇', pointsReward: 100 },
    { code: 'ORDERS_50', name: '50 Orders', description: 'Placed 50 orders', icon: '🥈', pointsReward: 300 },
    { code: 'ORDERS_100', name: 'Protein Panda Champion', description: 'Placed 100 orders — true panda loyalty', icon: '👑', pointsReward: 1000 },
  ];
  for (const a of achievements) {
    await prisma.achievementDefinition.upsert({ where: { code: a.code }, update: {}, create: a });
  }

  // Default food safety checklist — matches a typical daily
  // opening/closing routine. Fully admin-editable afterward from
  // /admin/food-safety; this just gives a new deployment something to
  // start from instead of an empty checklist.
  const foodSafetyItems: { label: string; category: string; sortOrder: number; requiresTemperature?: boolean; minTempC?: number; maxTempC?: number }[] = [
    { label: 'Opening checklist complete', category: 'OPENING', sortOrder: 1 },
    { label: 'Refrigerator temperature', category: 'TEMPERATURE', sortOrder: 2, requiresTemperature: true, minTempC: 0, maxTempC: 5 },
    { label: 'Freezer temperature', category: 'TEMPERATURE', sortOrder: 3, requiresTemperature: true, minTempC: -25, maxTempC: -15 },
    { label: 'Ingredient expiry check', category: 'OTHER', sortOrder: 4 },
    { label: 'Egg storage check', category: 'OTHER', sortOrder: 5 },
    { label: 'Milk storage check', category: 'OTHER', sortOrder: 6 },
    { label: 'Cleaning checklist complete', category: 'CLEANING', sortOrder: 7 },
    { label: 'Sanitization complete', category: 'SANITIZATION', sortOrder: 8 },
    { label: 'Staff hygiene check', category: 'HYGIENE', sortOrder: 9 },
    { label: 'Closing checklist complete', category: 'CLOSING', sortOrder: 10 },
  ];
  for (const item of foodSafetyItems) {
    const existing = await prisma.foodSafetyChecklistItem.findFirst({ where: { label: item.label } });
    if (!existing) {
      await prisma.foodSafetyChecklistItem.create({ data: item as any });
    }
  }

  // Broader store-operations checklist — distinct from food safety
  // above. Matches the opening/closing lists from the department spec
  // almost verbatim; fully admin-editable afterward.
  const storeChecklistItems: { label: string; type: 'OPENING' | 'CLOSING'; sortOrder: number }[] = [
    { label: 'Shop opened', type: 'OPENING', sortOrder: 1 },
    { label: 'Equipment checked', type: 'OPENING', sortOrder: 2 },
    { label: 'Refrigerator/freezer checked', type: 'OPENING', sortOrder: 3 },
    { label: 'Ingredients checked', type: 'OPENING', sortOrder: 4 },
    { label: 'Cleaning completed', type: 'OPENING', sortOrder: 5 },
    { label: 'POS operational', type: 'OPENING', sortOrder: 6 },
    { label: 'Payment systems operational', type: 'OPENING', sortOrder: 7 },
    { label: 'Cash opening balance entered', type: 'OPENING', sortOrder: 8 },
    { label: 'Staff attendance verified', type: 'OPENING', sortOrder: 9 },
    { label: 'All orders completed', type: 'CLOSING', sortOrder: 1 },
    { label: 'Pending orders checked', type: 'CLOSING', sortOrder: 2 },
    { label: 'Inventory checked', type: 'CLOSING', sortOrder: 3 },
    { label: 'Wastage recorded', type: 'CLOSING', sortOrder: 4 },
    { label: 'Cleaning completed', type: 'CLOSING', sortOrder: 5 },
    { label: 'Equipment checked', type: 'CLOSING', sortOrder: 6 },
    { label: 'Cash counted', type: 'CLOSING', sortOrder: 7 },
    { label: 'Payment reconciliation completed', type: 'CLOSING', sortOrder: 8 },
    { label: 'Staff shifts closed', type: 'CLOSING', sortOrder: 9 },
    { label: 'Closing report generated', type: 'CLOSING', sortOrder: 10 },
  ];
  for (const item of storeChecklistItems) {
    const existing = await prisma.storeChecklistItem.findFirst({ where: { label: item.label, type: item.type } });
    if (!existing) {
      await prisma.storeChecklistItem.create({ data: item });
    }
  }

  // ---------------------------------------------------------
  // TEST ACCOUNTS — one Owner, one demo staff member per
  // department, and one delivery rider. Real accounts, created
  // through the same upsert-by-phone pattern as everything else
  // in this seed file — not placeholders. Log in with any of
  // these phone numbers at /admin/login; there is no password —
  // request an OTP and read the actual code from your Railway
  // deploy logs (search for "[DEV FALLBACK] OTP for" — this only
  // ever appears when no real SMS/email provider is configured,
  // or its call failed, and never contains anything but the
  // 6-digit code for that specific phone number).
  //
  // Without this, a completely fresh database has no admin
  // account at all — creating staff is itself an admin-only
  // action, so there was previously no way to bootstrap the very
  // first login.
  const testAccounts: { phone: string; name: string; departments: string[]; position: string }[] = [
    { phone: '+910000000001', name: 'Owner', departments: [], position: 'Owner' },
    { phone: '+910000000010', name: 'Sales Demo', departments: ['SALES'], position: 'Sales Staff' },
    { phone: '+910000000011', name: 'Operations Demo', departments: ['OPERATIONS'], position: 'Kitchen Manager' },
    { phone: '+910000000012', name: 'Supply Chain Demo', departments: ['SUPPLY_CHAIN'], position: 'Inventory Manager' },
    { phone: '+910000000013', name: 'Loyalty Demo', departments: ['LOYALTY'], position: 'Loyalty Manager' },
    { phone: '+910000000014', name: 'Delivery Logistics Demo', departments: ['DELIVERY_LOGISTICS'], position: 'Delivery Manager' },
    { phone: '+910000000015', name: 'Finance Demo', departments: ['FINANCE_MARKETING'], position: 'Finance Manager' },
  ];
  for (const acc of testAccounts) {
    const user = await prisma.user.upsert({
      where: { phone: acc.phone },
      update: {},
      create: { phone: acc.phone, role: 'ADMIN', isActive: true },
    });
    await prisma.staff.upsert({
      where: { userId: user.id },
      update: { departments: acc.departments as any },
      create: { userId: user.id, name: acc.name, position: acc.position, departments: acc.departments as any },
    });
  }

  const deliveryUser = await prisma.user.upsert({
    where: { phone: '+910000000002' },
    update: {},
    create: { phone: '+910000000002', role: 'DELIVERY', isActive: true },
  });
  await prisma.deliveryPerson.upsert({
    where: { userId: deliveryUser.id },
    update: {},
    create: { userId: deliveryUser.id, name: 'Delivery Demo', vehicleInfo: 'Bike KA01AB1234' },
  });

  console.log('Seed complete:', { chocShake: chocShake.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
