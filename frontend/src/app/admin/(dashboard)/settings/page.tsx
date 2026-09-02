'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function AdminShopSettingsPage() {
  const [businessName, setBusinessName] = useState('');
  const [tagline, setTagline] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColorHex, setPrimaryColorHex] = useState('#6F8615');
  const [accentColorHex, setAccentColorHex] = useState('#82A51B');
  const [backgroundColorHex, setBackgroundColorHex] = useState('#F3F0E7');
  const [isOpen, setIsOpen] = useState(true);
  const [opensAt, setOpensAt] = useState('07:00');
  const [closesAt, setClosesAt] = useState('22:00');
  const [closureMessage, setClosureMessage] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [address, setAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [deliverablePincodes, setDeliverablePincodes] = useState('');
  const [shopLat, setShopLat] = useState('');
  const [shopLng, setShopLng] = useState('');
  const [fssaiNumber, setFssaiNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getShopStatus()
      .then((s) => {
        setBusinessName(s.businessName ?? '');
        setTagline(s.tagline ?? '');
        setLogoUrl(s.logoUrl ?? '');
        setPrimaryColorHex(s.primaryColorHex ?? '#6F8615');
        setAccentColorHex(s.accentColorHex ?? '#82A51B');
        setBackgroundColorHex(s.backgroundColorHex ?? '#F3F0E7');
        setIsOpen(s.isOpen);
        setOpensAt(s.opensAt);
        setClosesAt(s.closesAt);
        setClosureMessage(s.closureMessage ?? '');
        setContactPhone(s.contactPhone ?? '');
        setContactEmail(s.contactEmail ?? '');
        setWhatsappNumber(s.whatsappNumber ?? '');
        setAddress(s.address ?? '');
        setMapsUrl(s.mapsUrl ?? '');
        setInstagramUrl(s.instagramUrl ?? '');
        setFacebookUrl(s.facebookUrl ?? '');
        setYoutubeUrl(s.youtubeUrl ?? '');
        setDeliverablePincodes((s.deliverablePincodes ?? []).join(', '));
        setShopLat(s.shopLat != null ? String(s.shopLat) : '');
        setShopLng(s.shopLng != null ? String(s.shopLng) : '');
        setFssaiNumber(s.fssaiNumber ?? '');
      })
      .catch((err) => setError(err.message));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.adminUpdateShopStatus({
        businessName: businessName || undefined,
        tagline: tagline || null,
        logoUrl: logoUrl || null,
        primaryColorHex: primaryColorHex || undefined,
        accentColorHex: accentColorHex || undefined,
        backgroundColorHex: backgroundColorHex || undefined,
        isOpen,
        opensAt,
        closesAt,
        closureMessage: closureMessage || null,
        contactPhone: contactPhone || null,
        contactEmail: contactEmail || null,
        whatsappNumber: whatsappNumber || null,
        address: address || null,
        mapsUrl: mapsUrl || null,
        instagramUrl: instagramUrl || null,
        facebookUrl: facebookUrl || null,
        youtubeUrl: youtubeUrl || null,
        deliverablePincodes: deliverablePincodes
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        fssaiNumber: fssaiNumber || null,
        shopLat: shopLat ? Number(shopLat) : null,
        shopLng: shopLng ? Number(shopLng) : null,
      });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Shop Settings</h1>

      <div className="mb-6 max-w-lg rounded-2xl border border-brand-grey bg-brand-white p-6">
        <p className="mb-1 font-bold text-brand-black">Branding</p>
        <p className="mb-4 text-xs text-brand-body">
          Changes here take effect immediately across the whole site — no code changes, no rebuild.
        </p>
        <label className="mb-3 block text-xs font-semibold text-brand-body">
          Business name
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
          />
        </label>
        <label className="mb-3 block text-xs font-semibold text-brand-body">
          Tagline
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Fuel your fitness journey"
            className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
          />
        </label>
        <label className="mb-4 block text-xs font-semibold text-brand-body">
          Logo URL
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
          />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-brand-body">
            Primary color
            <input
              type="color"
              value={primaryColorHex}
              onChange={(e) => setPrimaryColorHex(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-brand-grey"
            />
          </label>
          <label className="text-xs font-semibold text-brand-body">
            Accent color
            <input
              type="color"
              value={accentColorHex}
              onChange={(e) => setAccentColorHex(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-brand-grey"
            />
          </label>
          <label className="text-xs font-semibold text-brand-body">
            Background color
            <input
              type="color"
              value={backgroundColorHex}
              onChange={(e) => setBackgroundColorHex(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-brand-grey"
            />
          </label>
        </div>
      </div>

      <div className="max-w-lg rounded-2xl border border-brand-grey bg-brand-white p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="font-bold text-brand-black">Shop Status</p>
            <p className="text-xs text-brand-body">Closed = customers cannot place any orders (website, app, or WhatsApp)</p>
          </div>
          <button
            onClick={() => setIsOpen((v) => !v)}
            className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wide ${
              isOpen ? 'bg-brand-primary text-brand-white' : 'bg-brand-grey/50 text-brand-black'
            }`}
          >
            {isOpen ? '🟢 Open' : '🔴 Closed'}
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <Field label="Opens at" type="time" value={opensAt} onChange={setOpensAt} />
          <Field label="Closes at" type="time" value={closesAt} onChange={setClosesAt} />
        </div>

        <Field
          label="Closure message (shown instead of hours when closed, optional)"
          value={closureMessage}
          onChange={setClosureMessage}
          placeholder="e.g. Closed for a public holiday"
          full
        />

        <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-brand-accent">Contact & Location</p>
        <div className="mb-1 grid grid-cols-2 gap-3">
          <Field label="Phone" value={contactPhone} onChange={setContactPhone} placeholder="+91 9xxxxxxxxx" />
          <Field label="Email" value={contactEmail} onChange={setContactEmail} placeholder="hello@proteinpanda.in" />
        </div>
        <Field label="Address" value={address} onChange={setAddress} placeholder="Shop address" full />
        <Field label="Google Maps link" value={mapsUrl} onChange={setMapsUrl} placeholder="https://maps.google.com/..." full />
        <Field
          label="WhatsApp number (digits only, with country code — no + or spaces)"
          value={whatsappNumber}
          onChange={setWhatsappNumber}
          placeholder="919876543210"
          full
        />
        <Field
          label="FSSAI license number (required for Indian food businesses — one per business, shown to customers)"
          value={fssaiNumber}
          onChange={setFssaiNumber}
          placeholder="e.g. 12345678901234"
          full
        />

        <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-brand-accent">Social Media</p>
        <Field label="Instagram URL" value={instagramUrl} onChange={setInstagramUrl} full />
        <Field label="Facebook URL" value={facebookUrl} onChange={setFacebookUrl} full />
        <Field label="YouTube URL" value={youtubeUrl} onChange={setYoutubeUrl} full />
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
            Deliverable Pincodes (comma-separated — leave blank to accept every pincode, no checking)
            <textarea
              value={deliverablePincodes}
              onChange={(e) => setDeliverablePincodes(e.target.value)}
              placeholder="e.g. 560001, 560002, 560034"
              rows={2}
              className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="sm:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-body">
            Shop Location (for distance-based delivery zone fees — leave blank to keep delivery free)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={shopLat}
              onChange={(e) => setShopLat(e.target.value.replace(/[^0-9.-]/g, ''))}
              placeholder="Latitude, e.g. 12.9716"
              inputMode="decimal"
              className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <input
              value={shopLng}
              onChange={(e) => setShopLng(e.target.value.replace(/[^0-9.-]/g, ''))}
              placeholder="Longitude, e.g. 77.5946"
              inputMode="decimal"
              className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
          </div>
          <p className="mt-1 text-[11px] text-brand-body">
            Manage the actual fee tiers on the{' '}
            <a href="/admin/delivery-zones" className="underline">
              Delivery Zones
            </a>{' '}
            page.
          </p>
        </div>

        {error && <p className="mb-3 mt-2 text-sm text-red-600">{error}</p>}
        {saved && <p className="mb-3 mt-2 text-sm text-brand-primary">Saved.</p>}

        <button
          onClick={save}
          disabled={saving}
          className="mt-4 w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <label className={`mb-3 block text-xs font-semibold uppercase tracking-wide text-brand-body ${full ? '' : ''}`}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black normal-case"
      />
    </label>
  );
}
