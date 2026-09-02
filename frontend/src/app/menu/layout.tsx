import type { Metadata } from 'next';
import { siteConfig } from '@/lib/siteConfig';

export const metadata: Metadata = {
  title: 'Menu',
  description: `Browse the full ${siteConfig.businessName} menu — protein shakes, diet food, and nutrition-tracked options, fully customisable.`,
};

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return children;
}
