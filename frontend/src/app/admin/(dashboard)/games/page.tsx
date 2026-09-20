'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Level {
  id: string;
  levelNumber: number;
  levelName: string;
  targetMetric: string;
  pointsAward: number;
}

interface Game {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  howToParticipate: string | null;
  rewardDescription: string | null;
  isActive: boolean;
  levels: Level[];
}

export default function AdminGamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);

  const load = () => {
    api.adminGames().then(setGames).catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const toggleActive = async (game: Game) => {
    try {
      await api.adminUpdateGame(game.id, { isActive: !game.isActive });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteGame = async (game: Game) => {
    if (!confirm(`Delete "${game.name}"? This cannot be undone.`)) return;
    try {
      await api.adminDeleteGame(game.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Games & Levels</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ Add Game'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <AddGameForm
          onDone={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="flex flex-col gap-3">
        {games.map((game) => (
          <div key={game.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setExpandedGameId(expandedGameId === game.id ? null : game.id)}
                className="text-left"
              >
                <p className="font-bold text-brand-black">{game.name}</p>
                <p className="text-xs text-brand-body">
                  {game.description ?? 'No description'} · {game.levels.length} level{game.levels.length !== 1 ? 's' : ''}
                </p>
              </button>
              <button
                onClick={() => toggleActive(game)}
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                  game.isActive ? 'bg-brand-grey/50 text-brand-black' : 'bg-brand-primary text-brand-white'
                }`}
              >
                {game.isActive ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => deleteGame(game)}
                className="rounded-full border-2 border-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-600 hover:text-white"
              >
                Delete
              </button>
            </div>

            {expandedGameId === game.id && (
              <>
                {editingGameId === game.id ? (
                  <EditGameDetails game={game} onSaved={() => { setEditingGameId(null); load(); }} onCancel={() => setEditingGameId(null)} />
                ) : (
                  <button onClick={() => setEditingGameId(game.id)} className="mb-3 mt-4 text-xs font-bold uppercase text-brand-primary hover:underline">
                    ✏️ Edit Rules & Rewards
                  </button>
                )}
                <LevelsEditor game={game} onChanged={load} />
              </>
            )}
          </div>
        ))}
        {games.length === 0 && <p className="text-sm text-brand-body">No games yet.</p>}
      </div>
    </div>
  );
}

function AddGameForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [howToParticipate, setHowToParticipate] = useState('');
  const [rewardDescription, setRewardDescription] = useState('');
  const [entryFeeRs, setEntryFeeRs] = useState('');
  const [freeAttemptMinPurchaseRs, setFreeAttemptMinPurchaseRs] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleImageFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const sig = await api.adminGameUploadSignature();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', sig.apiKey);
      formData.append('timestamp', String(sig.timestamp));
      formData.append('signature', sig.signature);
      formData.append('folder', sig.folder);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? 'Upload failed');
      }
      const { secure_url } = await res.json();
      setImageUrl(secure_url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateGame({
        name,
        description: description || undefined,
        rules: rules || undefined,
        howToParticipate: howToParticipate || undefined,
        rewardDescription: rewardDescription || undefined,
        imageUrl: imageUrl || undefined,
        entryFeeRs: entryFeeRs ? Number(entryFeeRs) : undefined,
        freeAttemptMinPurchaseRs: freeAttemptMinPurchaseRs ? Number(freeAttemptMinPurchaseRs) : undefined,
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-2">
      <input
        placeholder="Game name (e.g. Hanging Challenge)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      <input
        placeholder="Short description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      <textarea
        placeholder="Rules — shown on the public Games & Challenges page"
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        rows={2}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      <textarea
        placeholder="How to participate"
        value={howToParticipate}
        onChange={(e) => setHowToParticipate(e.target.value)}
        rows={2}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      <textarea
        placeholder="Reward for winners"
        value={rewardDescription}
        onChange={(e) => setRewardDescription(e.target.value)}
        rows={2}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      <input
        type="number"
        placeholder="Entry fee ₹ (leave blank or 0 for free-to-play)"
        value={entryFeeRs}
        onChange={(e) => setEntryFeeRs(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <input
        type="number"
        placeholder="₹ purchase for 1 free attempt (optional)"
        value={freeAttemptMinPurchaseRs}
        onChange={(e) => setFreeAttemptMinPurchaseRs(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-bold uppercase text-brand-body">Game Photo</label>
        <div className="flex items-center gap-3">
          {imageUrl && <img src={imageUrl} alt="Preview" className="h-14 w-14 rounded-lg object-cover" />}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFile(file);
            }}
            className="text-xs"
          />
          {uploading && <span className="text-xs text-brand-body">Uploading…</span>}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || !name.trim()}
        className="rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50 sm:col-span-2"
      >
        {saving ? 'Saving…' : 'Add Game'}
      </button>
    </div>
  );
}

function EditGameDetails({ game, onSaved, onCancel }: { game: Game; onSaved: () => void; onCancel: () => void }) {
  const [description, setDescription] = useState(game.description ?? '');
  const [rules, setRules] = useState(game.rules ?? '');
  const [howToParticipate, setHowToParticipate] = useState(game.howToParticipate ?? '');
  const [rewardDescription, setRewardDescription] = useState(game.rewardDescription ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminUpdateGame(game.id, {
        description: description || null,
        rules: rules || null,
        howToParticipate: howToParticipate || null,
        rewardDescription: rewardDescription || null,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-dashed border-brand-grey p-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" rows={2} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      <textarea value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Rules" rows={2} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      <textarea value={howToParticipate} onChange={(e) => setHowToParticipate(e.target.value)} placeholder="How to participate" rows={2} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      <textarea value={rewardDescription} onChange={(e) => setRewardDescription(e.target.value)} placeholder="Reward for winners" rows={2} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="rounded-full bg-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-white disabled:opacity-60">
          {saving ? 'Saving…' : 'Save Details'}
        </button>
        <button onClick={onCancel} className="text-xs font-bold uppercase text-brand-body">
          Cancel
        </button>
      </div>
    </div>
  );
}

function LevelsEditor({ game, onChanged }: { game: Game; onChanged: () => void }) {
  const [showAddLevel, setShowAddLevel] = useState(false);
  const [levelNumber, setLevelNumber] = useState('');
  const [levelName, setLevelName] = useState('');
  const [targetMetric, setTargetMetric] = useState('');
  const [pointsAward, setPointsAward] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const usedNumbers = new Set(game.levels.map((l) => l.levelNumber));
  const nextAvailable = [1, 2, 3, 4].find((n) => !usedNumbers.has(n));

  const addLevel = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateGameLevel(game.id, {
        levelNumber: Number(levelNumber),
        levelName,
        targetMetric: Number(targetMetric),
        pointsAward: Number(pointsAward),
      });
      setLevelNumber('');
      setLevelName('');
      setTargetMetric('');
      setPointsAward('');
      setShowAddLevel(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeLevel = async (levelId: string) => {
    try {
      await api.adminDeleteGameLevel(levelId);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="mt-4 border-t border-brand-grey pt-4">
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="mb-3 flex flex-col gap-2">
        {game.levels.map((level) => (
          <div key={level.id} className="flex items-center justify-between rounded-lg bg-brand-bg px-3 py-2 text-sm">
            <span>
              Level {level.levelNumber} · {level.levelName} — target {level.targetMetric}, {level.pointsAward} pts
            </span>
            <button onClick={() => removeLevel(level.id)} className="text-xs text-red-600">
              Remove
            </button>
          </div>
        ))}
        {game.levels.length === 0 && <p className="text-xs text-brand-body">No levels yet — add up to 4.</p>}
      </div>

      {game.levels.length < 4 && (
        <>
          <button
            onClick={() => {
              setShowAddLevel((v) => !v);
              if (nextAvailable) setLevelNumber(String(nextAvailable));
            }}
            className="text-xs font-bold uppercase text-brand-primary underline"
          >
            {showAddLevel ? 'Cancel' : '+ Add Level'}
          </button>

          {showAddLevel && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select
                value={levelNumber}
                onChange={(e) => setLevelNumber(e.target.value)}
                className="rounded-lg border border-brand-grey px-2 py-2 text-sm"
              >
                <option value="">Level #</option>
                {[1, 2, 3, 4]
                  .filter((n) => !usedNumbers.has(n))
                  .map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
              </select>
              <input
                placeholder="Name (e.g. Beginner)"
                value={levelName}
                onChange={(e) => setLevelName(e.target.value)}
                className="rounded-lg border border-brand-grey px-2 py-2 text-sm"
              />
              <input
                type="number"
                placeholder="Target (e.g. seconds)"
                value={targetMetric}
                onChange={(e) => setTargetMetric(e.target.value)}
                className="rounded-lg border border-brand-grey px-2 py-2 text-sm"
              />
              <input
                type="number"
                placeholder="Points"
                value={pointsAward}
                onChange={(e) => setPointsAward(e.target.value)}
                className="rounded-lg border border-brand-grey px-2 py-2 text-sm"
              />
              <button
                onClick={addLevel}
                disabled={saving || !levelNumber || !levelName.trim() || !targetMetric || !pointsAward}
                className="rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50 sm:col-span-4"
              >
                {saving ? 'Saving…' : 'Save Level'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
