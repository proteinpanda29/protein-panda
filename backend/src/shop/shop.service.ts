import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const SETTINGS_ID = 'default';

interface ShopSettingsInput {
  isOpen?: boolean;
  opensAt?: string;
  closesAt?: string;
  closureMessage?: string | null;
  businessName?: string;
  tagline?: string | null;
  logoUrl?: string | null;
  primaryColorHex?: string;
  accentColorHex?: string;
  backgroundColorHex?: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  whatsappNumber?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  youtubeUrl?: string | null;
  fssaiNumber?: string | null;
  deliverablePincodes?: string[];
  shopLat?: number | null;
  shopLng?: number | null;
}

// Same haversine calculation already proven for the customer-facing
// live-delivery ETA — reused here for the shop-to-customer distance
// that determines which delivery zone/fee applies.
function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

@Injectable()
export class ShopService {
  constructor(private prisma: PrismaService) {}

  async getStatus() {
    const settings = await this.prisma.shopSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
    return settings;
  }

  /** Used by OrdersService to block order placement while the shop is closed. */
  async isOpen(): Promise<boolean> {
    const settings = await this.prisma.shopSettings.findUnique({ where: { id: SETTINGS_ID } });
    return settings?.isOpen ?? true; // default open if never configured
  }

  /**
   * Empty/unconfigured list = every pincode is accepted — checking is
   * effectively off until an admin actually opts in by adding at least
   * one. Normalizes whitespace/case so "560001", " 560001 ", and
   * "560001\n" all match the same stored entry.
   */
  async isPincodeServiceable(pincode: string): Promise<boolean> {
    const settings = await this.prisma.shopSettings.findUnique({ where: { id: SETTINGS_ID } });
    const list = settings?.deliverablePincodes ?? [];
    if (list.length === 0) return true;
    return list.map((p: string) => p.trim()).includes(pincode.trim());
  }

  /** One-click toggle for the simple admin ON/OFF switch. */
  async toggle() {
    const current = await this.getStatus();
    return this.prisma.shopSettings.update({ where: { id: SETTINGS_ID }, data: { isOpen: !current.isOpen } });
  }

  async updateStatus(data: ShopSettingsInput) {
    return this.prisma.shopSettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
  }

  // ---------------------------------------------------------
  // DELIVERY ZONES — distance-based fees, replacing (well,
  // complementing — the pincode allow-list above still runs as a
  // separate, coarser check) a flat "delivery is free" default with
  // real tiers based on actual distance from the shop.
  // ---------------------------------------------------------

  async listDeliveryZones() {
    return this.prisma.deliveryZone.findMany({ orderBy: { maxDistanceKm: 'asc' } });
  }

  async createDeliveryZone(data: { name: string; maxDistanceKm: number; feeRs: number; estimatedMinutes?: number }) {
    if (data.maxDistanceKm <= 0) throw new Error('Max distance must be positive');
    if (data.feeRs < 0) throw new Error('Fee cannot be negative');
    return this.prisma.deliveryZone.create({ data });
  }

  async updateDeliveryZone(id: string, data: Partial<{ name: string; maxDistanceKm: number; feeRs: number; estimatedMinutes: number; isActive: boolean }>) {
    return this.prisma.deliveryZone.update({ where: { id }, data });
  }

  async deleteDeliveryZone(id: string) {
    return this.prisma.deliveryZone.delete({ where: { id } });
  }

  /**
   * The real fee quote — computes actual distance from the shop to the
   * given delivery coordinates, then finds the nearest (cheapest)
   * matching zone. Returns null, not a thrown error, when the shop
   * hasn't configured its own location, has no active zones at all, or
   * the customer is beyond every zone's range — all three are genuine
   * "no zone-based fee applies" outcomes, not failures, and callers
   * (checkout, order creation) fall back to free delivery in that case
   * rather than blocking the order.
   */
  async quoteDeliveryFee(customerLat: number, customerLng: number) {
    const settings = await this.prisma.shopSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (settings?.shopLat == null || settings?.shopLng == null) return null;

    const zones = await this.prisma.deliveryZone.findMany({
      where: { isActive: true },
      orderBy: { maxDistanceKm: 'asc' },
    });
    if (zones.length === 0) return null;

    const distanceKm = haversineDistanceKm({ lat: settings.shopLat, lng: settings.shopLng }, { lat: customerLat, lng: customerLng });
    const zone = zones.find((z: { maxDistanceKm: number }) => distanceKm <= Number(z.maxDistanceKm));
    if (!zone) return null; // beyond every configured zone — not deliverable by distance

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      distanceKm: Math.round(distanceKm * 10) / 10,
      feeRs: Number(zone.feeRs),
      estimatedMinutes: zone.estimatedMinutes,
    };
  }
}
