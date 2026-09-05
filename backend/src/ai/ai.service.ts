import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// gemini-pro-latest — an alias Google keeps pointed at their current
// best Pro model (as of this writing, gemini-3-pro-preview), so this
// never needs manual updating as new Gemini versions ship. Requires
// billing enabled on the API key — the free AI Studio tier only covers
// Flash/Flash-Lite models, not Pro. Check ai.google.dev/gemini-api/docs/pricing
// for current rates before deploying.
const MODEL = 'gemini-pro-latest';
const MAX_HISTORY_MESSAGES = 20; // keep requests bounded; frontend can still keep full history locally

/**
 * Keyword-based pre-flight check on the customer's latest message —
 * deliberately simple (no second LLM call, no external moderation
 * service) so it's fast, free, and has no failure mode that could block
 * the chat. This is defense in depth on top of the baseline system
 * prompt rule below, not a replacement for it: the baseline rule covers
 * cases these patterns miss, and this reinforces the same rule more
 * forcefully — with an audit trail — when a known-sensitive topic is
 * explicitly named.
 */
const MEDICAL_RISK_PATTERNS: { category: string; pattern: RegExp }[] = [
  { category: 'PREGNANCY', pattern: /\b(pregnan(?:t|cy)|breastfeed(?:ing)?|nursing (?:my )?baby)\b/i },
  { category: 'DIABETES', pattern: /\b(diabet(?:es|ic)|blood sugar|insulin)\b/i },
  { category: 'KIDNEY_DISEASE', pattern: /\b(kidney disease|dialysis|renal (?:failure|disease)|\bckd\b)\b/i },
  { category: 'LIVER_DISEASE', pattern: /\b(liver disease|hepatitis|cirrhosis)\b/i },
  { category: 'MEDICATION', pattern: /\b(medication|prescri(?:bed|ption)|blood thinner|warfarin|on meds)\b/i },
  { category: 'SEVERE_ALLERGY', pattern: /\b(anaphyla(?:xis|ctic)|epipen|severe allergy|life-threatening allerg)\b/i },
  { category: 'CHILDREN', pattern: /\b(my (?:child|kid|toddler|infant|baby)|\d{1,2}[\s-]?year[\s-]?old (?:child|kid|son|daughter))\b/i },
];

@Injectable()
export class AiService {
  private logger = new Logger('AiService');

  constructor(private prisma: PrismaService) {}

  async chat(customerId: string, messages: ChatMessage[]) {
    if (!messages.length) throw new BadRequestException('messages must not be empty');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('AI assistant is not configured (GEMINI_API_KEY missing)');
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const riskCategories = this.detectMedicalRiskCategories(lastUserMessage);

    if (riskCategories.length > 0) {
      // Never let logging failure block the chat itself.
      this.prisma.aiSafetyFlag
        .create({
          data: { customerId, categories: riskCategories, messageExcerpt: lastUserMessage.slice(0, 200) },
        })
        .catch((err: unknown) => this.logger.warn(`Failed to record AI safety flag: ${(err as Error).message}`));
    }

    const systemPrompt = await this.buildSystemPrompt(customerId, riskCategories);
    const trimmedHistory = messages.slice(-MAX_HISTORY_MESSAGES);

    // Gemini's request shape differs from Anthropic's in a few
    // specific ways: the API key goes in a header (not the body),
    // conversation turns are called "contents" with role "model"
    // (not "assistant") for the AI's own turns, and the system prompt
    // is a separate top-level "systemInstruction" field rather than a
    // "system" string alongside messages.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: trimmedHistory.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 500 },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new InternalServerErrorException(`AI assistant request failed: ${response.status} ${errBody}`);
    }

    const data = await response.json();
    // A blocked response (safety filter, recitation, etc.) has no
    // parts at all rather than an HTTP error — surfaced as a normal,
    // if unhelpful, reply rather than a crash, since the app's own
    // medical-safety system prompt above is the real safety net here.
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { reply };
  }

  private detectMedicalRiskCategories(message: string): string[] {
    return MEDICAL_RISK_PATTERNS.filter((p) => p.pattern.test(message)).map((p) => p.category);
  }

  /**
   * Grounds every response in this specific customer's real data — goal,
   * remaining protein/calorie budget today, allergies, and the live
   * product catalog with nutrition — so recommendations are accurate and
   * never suggest something the customer is allergic to.
   */
  private async buildSystemPrompt(customerId: string, riskCategories: string[] = []): Promise<string> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [customer, todayLogs, products, shopSettings] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
        include: { allergies: { include: { allergen: true } } },
      }),
      this.prisma.nutritionLog.findMany({ where: { customerId, loggedAt: { gte: startOfToday } } }),
      this.prisma.product.findMany({
        where: { isActive: true },
        include: { nutrition: true, allergens: { include: { allergen: true } }, category: true },
        take: 40,
      }),
      this.prisma.shopSettings.findUnique({ where: { id: 'default' } }),
    ]);

    const businessName = shopSettings?.businessName ?? 'Protein Panda';

    const proteinSoFar = todayLogs.reduce((sum: number, l: { proteinG: unknown }) => sum + Number(l.proteinG), 0);
    const caloriesSoFar = todayLogs.reduce((sum: number, l: { calories: number }) => sum + l.calories, 0);
    const proteinGoal = customer.dailyProteinGoalG ? Number(customer.dailyProteinGoalG) : null;
    const proteinRemaining = proteinGoal !== null ? Math.max(proteinGoal - proteinSoFar, 0) : null;
    const allergenNames = customer.allergies.map((a: { allergen: { name: string } }) => a.allergen.name);

    const catalogLines = products
      .map((p: any) => {
        const n = p.nutrition;
        const allergenTag = p.allergens.length
          ? ` [contains: ${p.allergens.map((a: { allergen: { name: string } }) => a.allergen.name).join(', ')}]`
          : '';
        return `- ${p.name} (${p.category.name}, ${p.isVeg ? 'veg' : 'non-veg'}, ₹${p.basePriceRs}${n ? `, ${n.proteinG}g protein, ${n.calories} kcal` : ''})${allergenTag}`;
      })
      .join('\n');

    let prompt = `You are the ${businessName} AI Nutrition Assistant — a friendly, knowledgeable guide for a fitness-focused food shop's app. Brand tone: encouraging, concise, practical. Use the mascot emoji sparingly, if the brand has one — don't overdo emoji.

CUSTOMER CONTEXT (use this to personalize every answer):
- Name: ${customer.name}
- Goal: ${customer.goal ?? 'not set'}
- Dietary preference: ${customer.dietaryPreference ?? 'not set'}
- Allergies: ${allergenNames.length ? allergenNames.join(', ') : 'none recorded'}
- Daily protein target: ${proteinGoal !== null ? `${proteinGoal}g` : 'not set'}
- Protein consumed today: ${proteinSoFar}g
- Protein remaining today: ${proteinRemaining !== null ? `${proteinRemaining}g` : 'unknown (no target set)'}
- Calories consumed today: ${caloriesSoFar} kcal

CURRENT MENU (this is the ONLY source of truth for products, prices, and nutrition — never invent a ${businessName} product, price, or nutrition figure that isn't listed here):
${catalogLines || '(menu is currently empty)'}

RULES:
- NEVER recommend a product whose allergen tag overlaps with the customer's recorded allergies, even if they ask for it — point out the conflict instead and suggest an alternative.
- Base all protein/calorie claims on the CURRENT MENU data above — don't invent nutrition figures.
- MEDICAL SAFETY — treat these as hard limits, not suggestions: if a question touches pregnancy or breastfeeding, diabetes, kidney disease, liver disease, a medication or drug interaction, a severe/anaphylactic allergy, or a child's diet, you must NOT give a specific numeric nutrition target, dosage, or medical recommendation for that condition. Share only general, well-known nutrition information where it's directly relevant to the menu, and clearly and warmly direct them to their doctor, a registered dietitian, or (for a child) a pediatrician for anything specific to their condition, medication, or child. Never diagnose, never imply your answer overrides professional medical advice, and never guess at what's medically safe for someone in these situations.
- Keep answers short and scannable (2-4 sentences, or a short bulleted list of 2-3 menu suggestions with their protein/calorie numbers).
- If a recommendation fits, end with a light nudge like "Want me to add this to your cart?" but you cannot place orders yourself — direct them to the menu page to actually order.
- Stay on topic: nutrition, the ${businessName} menu, orders, goals, and general fitness/diet questions. Politely redirect off-topic requests back to how you can help with their nutrition.`;

    if (riskCategories.length > 0) {
      prompt += `\n\nIMPORTANT — the customer's latest message touches a sensitive medical topic (${riskCategories.join(', ')}). Apply the MEDICAL SAFETY rule above strictly for this reply: no specific numeric targets, dosages, or medical recommendations. General information only where directly relevant to the menu, plus a warm, clear referral to a qualified professional.`;
    }

    return prompt;
  }
}
