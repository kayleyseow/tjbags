import { useEffect, useMemo, useState } from 'react'
import type {
  CategoryVisibility,
  EncyclopediaBag,
  PantryBag,
  Store,
} from '../../types'
import { DEFAULT_VISIBILITY } from '../../types'
import StoreSelect from './StoreSelect'
import { looksLikeHeic, normalizeImageFile } from './heic'
import { parseLocalDate } from '../../dates'

const BASE = import.meta.env.BASE_URL
const WORKER_URL = import.meta.env.VITE_WORKER_URL

type Props = { password: string }

type LoadedData = {
  pantry: PantryBag[]
  encyclopedia: EncyclopediaBag[]
  stores: Map<string, Store>
  visibility: CategoryVisibility
}

type View =
  | { kind: 'list' }
  | { kind: 'edit'; original: PantryBag }

export default function EditPanel({ password }: Props) {
  const [data, setData] = useState<LoadedData | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${BASE}data/pantry.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<PantryBag[]>),
      fetch(`${BASE}data/encyclopedia.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<EncyclopediaBag[]>),
      fetch(`${BASE}data/stores.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<Store[]>),
      fetch(`${BASE}data/visibility.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? (r.json() as Promise<CategoryVisibility>) : null))
        .catch(() => null),
    ])
      .then(([pantry, encyclopedia, storeList, vis]) => {
        if (cancelled) return
        setData({
          pantry,
          encyclopedia,
          stores: new Map(storeList.map((s) => [s.storeNumber, s])),
          visibility: { ...DEFAULT_VISIBILITY, ...(vis ?? {}) },
        })
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError((err as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function refreshAfterChange(updated: PantryBag[]) {
    setData((prev) => (prev ? { ...prev, pantry: updated } : prev))
    setView({ kind: 'list' })
  }

  if (loadError) {
    return (
      <p className="italic text-sm text-[var(--tj-red)]">
        Couldn't load pantry data: {loadError}
      </p>
    )
  }
  if (!data) {
    return <p className="italic text-sm opacity-65">Loading entries…</p>
  }

  if (view.kind === 'edit') {
    return (
      <EditForm
        password={password}
        original={view.original}
        data={data}
        onBack={() => setView({ kind: 'list' })}
        onSaved={(updatedEntry) => {
          const next = data.pantry.map((b) =>
            b.slug === view.original.slug ? updatedEntry : b,
          )
          refreshAfterChange(next)
        }}
        onDeleted={() => {
          const next = data.pantry.filter((b) => b.slug !== view.original.slug)
          refreshAfterChange(next)
        }}
      />
    )
  }

  return (
    <EntryList
      data={data}
      onPick={(bag) => setView({ kind: 'edit', original: bag })}
    />
  )
}

/* ──────────────────────────  List view  ────────────────────────── */

function EntryList({
  data,
  onPick,
}: {
  data: LoadedData
  onPick: (bag: PantryBag) => void
}) {
  const sorted = useMemo(
    () =>
      [...data.pantry].sort(
        (a, b) =>
          new Date(b.dateAcquired).getTime() - new Date(a.dateAcquired).getTime(),
      ),
    [data.pantry],
  )

  if (sorted.length === 0) {
    return (
      <p className="italic text-sm opacity-65 text-center py-8">
        No bags in the pantry yet. Log one first!
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="font-[var(--tj-body)] italic text-sm opacity-75">
        Pick an entry to edit or delete. Newest first.
      </p>
      <ul className="divide-y-2 divide-[var(--tj-ink)]/20 border-2 border-[var(--tj-ink)] bg-white">
        {sorted.map((bag) => {
          const store = data.stores.get(bag.storeNumber)
          return (
            <li key={bag.slug}>
              <button
                type="button"
                onClick={() => onPick(bag)}
                className="w-full text-left px-4 py-3 hover:bg-[var(--tj-kraft)]/40 focus:bg-[var(--tj-kraft)]/40 focus:outline-none transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span
                    className="text-[var(--tj-red)] text-2xl leading-none"
                    style={{ fontFamily: 'var(--tj-script)' }}
                  >
                    {bag.name ?? bag.slug}
                  </span>
                  <span className="font-[var(--tj-body)] tracking-[0.2em] text-[0.65rem] uppercase opacity-65">
                    Edit →
                  </span>
                </div>
                <div className="mt-1 font-[var(--tj-body)] tracking-[0.18em] text-[0.65rem] uppercase opacity-70">
                  {formatDate(bag.dateAcquired)}
                  {store ? ` · ${store.name}, ${store.state} (#${store.storeNumber})` : ` · Store #${bag.storeNumber}`}
                </div>
                {bag.memory && (
                  <p className="mt-2 italic text-sm opacity-80 line-clamp-2">
                    "{bag.memory}"
                  </p>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ──────────────────────────  Edit form  ────────────────────────── */

type PhotoSlot =
  | { kind: 'existing'; path: string }
  | { kind: 'new'; file: File; previewUrl: string }

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'confirming-save' }
  | { kind: 'confirming-delete' }
  | { kind: 'saving' }
  | { kind: 'deleting' }
  | { kind: 'error'; message: string }

function EditForm({
  password,
  original,
  data,
  onBack,
  onSaved,
  onDeleted,
}: {
  password: string
  original: PantryBag
  data: LoadedData
  onBack: () => void
  onSaved: (updated: PantryBag) => void
  onDeleted: () => void
}) {
  const [encyclopediaId, setEncyclopediaId] = useState(original.encyclopediaId ?? '')
  const [store, setStore] = useState<Store | null>(
    data.stores.get(original.storeNumber) ?? null,
  )
  const [date, setDate] = useState(original.dateAcquired)
  const [memory, setMemory] = useState(original.memory)
  const [photos, setPhotos] = useState<PhotoSlot[]>(() =>
    (original.photos ?? []).map((p) => ({ kind: 'existing' as const, path: p })),
  )
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })

  // Revoke object URLs when component unmounts or photos change.
  useEffect(() => {
    return () => {
      for (const p of photos) {
        if (p.kind === 'new') URL.revokeObjectURL(p.previewUrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visibleEncyclopedia = useMemo(
    () =>
      data.encyclopedia.filter((bag) => {
        if (bag.type === 'state') return data.visibility.state
        if (bag.type === 'special') return data.visibility.special
        if (bag.type === 'standard') return data.visibility.standard
        return true
      }),
    [data.encyclopedia, data.visibility],
  )

  const selectedEncyclopediaBag = useMemo(
    () => data.encyclopedia.find((b) => b.id === encyclopediaId) ?? null,
    [data.encyclopedia, encyclopediaId],
  )

  // Recompute slug the same way BagForm does. If the encyclopediaId or date
  // changes vs the original, the slug will shift — the worker handles the
  // rename and updates pantry.json so all polaroid links auto-follow.
  const newSlug = selectedEncyclopediaBag
    ? `${selectedEncyclopediaBag.id}-${date}`
    : original.slug
  const slugChanged = newSlug !== original.slug
  // Reject collisions with *other* entries.
  const duplicateSlug =
    slugChanged && data.pantry.some((b) => b.slug !== original.slug && b.slug === newSlug)
  // Other logs of the same encyclopedia bag, excluding the entry being
  // edited — drives the soft "previously logged" warning.
  const otherLogsOfSameBag = useMemo(
    () =>
      selectedEncyclopediaBag
        ? data.pantry.filter(
            (b) =>
              b.encyclopediaId === selectedEncyclopediaBag.id && b.slug !== original.slug,
          )
        : [],
    [data.pantry, selectedEncyclopediaBag, original.slug],
  )
  const alreadyLoggedBefore = otherLogsOfSameBag.length > 0 && !duplicateSlug

  const valid =
    selectedEncyclopediaBag !== null &&
    store !== null &&
    date !== '' &&
    memory.trim().length > 0 &&
    !duplicateSlug

  function addPhotos(files: File[]) {
    if (files.length === 0) return
    const next: PhotoSlot[] = [...photos]
    for (const file of files) {
      if (next.length >= 8) break
      next.push({ kind: 'new', file, previewUrl: URL.createObjectURL(file) })
    }
    setPhotos(next)
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const slot = prev[index]
      if (slot?.kind === 'new') URL.revokeObjectURL(slot.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setPhotos((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  async function doSave() {
    if (!valid || !selectedEncyclopediaBag || !store) return
    setStatus({ kind: 'saving' })
    if (!WORKER_URL) {
      setStatus({ kind: 'error', message: 'Worker URL not configured — cannot save.' })
      return
    }
    try {
      const photoPlan = await Promise.all(
        photos.map(async (slot) => {
          if (slot.kind === 'existing') {
            return { kind: 'existing' as const, path: slot.path }
          }
          return {
            kind: 'new' as const,
            name: slot.file.name,
            base64: await fileToBase64(slot.file),
          }
        }),
      )

      const bag = {
        slug: newSlug,
        name: bagDisplayName(selectedEncyclopediaBag),
        encyclopediaId: selectedEncyclopediaBag.id,
        storeNumber: store.storeNumber,
        dateAcquired: date,
        memory: memory.trim(),
      }

      const res = await fetch(`${WORKER_URL}/pantry/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          originalSlug: original.slug,
          bag,
          photoPlan,
        }),
      })

      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        photos?: string[]
      }

      if (!res.ok || !result.ok) {
        setStatus({ kind: 'error', message: result.error ?? `Save failed (${res.status})` })
        return
      }

      const updated: PantryBag = {
        ...original,
        slug: bag.slug,
        name: bag.name,
        encyclopediaId: bag.encyclopediaId,
        storeNumber: bag.storeNumber,
        dateAcquired: bag.dateAcquired,
        memory: bag.memory,
        photos: result.photos ?? [],
      }
      onSaved(updated)
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message })
    }
  }

  async function doDelete() {
    setStatus({ kind: 'deleting' })
    if (!WORKER_URL) {
      setStatus({ kind: 'error', message: 'Worker URL not configured — cannot delete.' })
      return
    }
    try {
      const res = await fetch(`${WORKER_URL}/pantry/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, slug: original.slug }),
      })
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !result.ok) {
        setStatus({ kind: 'error', message: result.error ?? `Delete failed (${res.status})` })
        return
      }
      onDeleted()
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message })
    }
  }

  const isBusy = status.kind === 'saving' || status.kind === 'deleting'

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        disabled={isBusy}
        className="font-[var(--tj-body)] tracking-[0.2em] text-[0.7rem] uppercase opacity-70 hover:opacity-100 hover:underline underline-offset-4 disabled:opacity-40"
      >
        ← Back to list
      </button>

      <div className="border border-[var(--tj-ink)]/30 bg-[var(--tj-kraft)]/20 px-3 py-2 text-xs italic">
        Editing <code className="bg-white/60 px-1.5 py-0.5">{original.slug}</code>
        {slugChanged && (
          <>
            {' '}→ <code className="bg-white/60 px-1.5 py-0.5">{newSlug}</code>
          </>
        )}
      </div>

      <Field
        label="Which Bag?"
        hint="The encyclopedia entry this bag corresponds to."
      >
        <EncyclopediaPicker
          encyclopedia={visibleEncyclopedia}
          value={encyclopediaId}
          onChange={setEncyclopediaId}
        />
      </Field>

      <Field
        label="Where Did You Buy It?"
        hint="Search Trader Joe's stores by city, state, or store number."
      >
        <StoreSelect value={store} onChange={setStore} />
      </Field>

      <Field label="Date Acquired">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          max={todayISO()}
          className="w-full border-2 border-[var(--tj-ink)] bg-[var(--tj-cream)] px-3 py-2.5 font-serif text-base outline-none focus:bg-white transition-colors"
        />
      </Field>

      <Field
        label="The Memory"
        hint="Tell the story. Who were you with? What were you shopping for?"
      >
        <textarea
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          required
          rows={5}
          maxLength={1200}
          className="w-full border-2 border-[var(--tj-ink)] bg-[var(--tj-cream)] px-3 py-2.5 font-serif text-base outline-none focus:bg-white transition-colors resize-y"
        />
        <div className="text-right text-[0.65rem] opacity-50 font-[var(--tj-body)] tracking-wider mt-1">
          {memory.length} / 1200
        </div>
      </Field>

      <Field
        label="Photos"
        hint="Drag to reorder using the arrows. First photo is the hero shot on the polaroid."
      >
        <PhotoEditor
          photos={photos}
          onAdd={addPhotos}
          onRemove={removePhoto}
          onMove={movePhoto}
        />
      </Field>

      {alreadyLoggedBefore && (
        <div className="border-2 border-[var(--tj-kraft)] bg-[var(--tj-kraft)]/20 px-4 py-3 text-sm">
          <strong className="font-[var(--tj-body)] tracking-[0.15em] text-xs uppercase block mb-1">
            Previously logged
          </strong>
          <span className="italic opacity-90">
            This bag has been logged{' '}
            {otherLogsOfSameBag.length === 1
              ? 'once'
              : `${otherLogsOfSameBag.length} times`}{' '}
            elsewhere
            {otherLogsOfSameBag.length <= 3
              ? ` (${otherLogsOfSameBag
                  .map((b) => b.dateAcquired)
                  .sort()
                  .join(', ')})`
              : ''}
            .
          </span>
        </div>
      )}

      {duplicateSlug && (
        <div className="border-2 border-[var(--tj-red)] bg-[var(--tj-red)]/10 px-4 py-3 text-sm">
          <strong className="font-[var(--tj-body)] tracking-[0.15em] text-xs uppercase block mb-1">
            Slug conflict
          </strong>
          <span className="italic opacity-90">
            Another entry already uses the slug "{newSlug}". Pick a different date or bag.
          </span>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="border-2 border-[var(--tj-red)] bg-[var(--tj-red)]/10 px-4 py-3 text-sm">
          <strong className="font-[var(--tj-body)] tracking-[0.15em] text-xs uppercase block mb-1">
            Something went wrong
          </strong>
          <span className="italic opacity-90">{status.message}</span>
        </div>
      )}

      <div className="pt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStatus({ kind: 'confirming-delete' })}
          disabled={isBusy}
          className="font-[var(--tj-body)] tracking-[0.25em] text-xs uppercase border-2 border-[var(--tj-red)] text-[var(--tj-red)] px-5 py-2.5 hover:bg-[var(--tj-red)] hover:text-[var(--tj-cream)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Delete Entry
        </button>
        <button
          type="button"
          onClick={() => setStatus({ kind: 'confirming-save' })}
          disabled={!valid || isBusy}
          className="font-[var(--tj-body)] tracking-[0.25em] text-xs uppercase border-2 border-[var(--tj-ink)] bg-[var(--tj-ink)] text-[var(--tj-cream)] px-6 py-3 hover:bg-transparent hover:text-[var(--tj-ink)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status.kind === 'saving' ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {status.kind === 'confirming-save' && (
        <ConfirmDialog
          title="Save these changes?"
          body={
            slugChanged
              ? `This will rewrite the entry — including renaming its URL from "${original.slug}" to "${newSlug}".`
              : "This will update the entry in the pantry and trigger a rebuild (~1 minute)."
          }
          confirmLabel="Yes, save"
          confirmVariant="primary"
          onConfirm={doSave}
          onCancel={() => setStatus({ kind: 'idle' })}
        />
      )}

      {status.kind === 'confirming-delete' && (
        <ConfirmDialog
          title={`Delete "${original.name ?? original.slug}"?`}
          body="This permanently removes the entry from the pantry and deletes its uploaded photos from the repo. This can't be undone (without a git revert)."
          confirmLabel="Yes, delete"
          confirmVariant="danger"
          onConfirm={doDelete}
          onCancel={() => setStatus({ kind: 'idle' })}
        />
      )}
    </div>
  )
}

/* ──────────────────────────  Photo editor  ────────────────────────── */

function PhotoEditor({
  photos,
  onAdd,
  onRemove,
  onMove,
}: {
  photos: PhotoSlot[]
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
  onMove: (index: number, direction: -1 | 1) => void
}) {
  const [converting, setConverting] = useState(0)
  const [convertError, setConvertError] = useState<string | null>(null)

  async function handlePicked(files: FileList | null) {
    if (!files) return
    setConvertError(null)
    const picked = Array.from(files)
    const heicCount = picked.filter(looksLikeHeic).length
    if (heicCount > 0) setConverting((n) => n + heicCount)
    try {
      const normalized = await Promise.all(picked.map(normalizeImageFile))
      onAdd(normalized)
    } catch (err) {
      setConvertError(
        `Couldn't convert a HEIC photo: ${(err as Error).message}. Try re-exporting as JPEG.`,
      )
    } finally {
      if (heicCount > 0) setConverting((n) => Math.max(0, n - heicCount))
    }
  }

  return (
    <div className="space-y-3">
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((slot, i) => (
            <li
              key={slot.kind === 'existing' ? slot.path : `${slot.file.name}-${i}`}
              className="relative border-2 border-[var(--tj-ink)] bg-white"
            >
              <div className="aspect-square overflow-hidden bg-[var(--tj-kraft)]/30">
                <img
                  src={
                    slot.kind === 'existing'
                      ? resolvePhotoUrl(slot.path)
                      : slot.previewUrl
                  }
                  alt={slot.kind === 'existing' ? slot.path : slot.file.name}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex items-stretch border-t-2 border-[var(--tj-ink)] divide-x-2 divide-[var(--tj-ink)]">
                <button
                  type="button"
                  onClick={() => onMove(i, -1)}
                  disabled={i === 0}
                  aria-label="Move earlier"
                  className="flex-1 py-1 font-[var(--tj-body)] text-xs hover:bg-[var(--tj-ink)] hover:text-[var(--tj-cream)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--tj-ink)] transition-colors"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(i, 1)}
                  disabled={i === photos.length - 1}
                  aria-label="Move later"
                  className="flex-1 py-1 font-[var(--tj-body)] text-xs hover:bg-[var(--tj-ink)] hover:text-[var(--tj-cream)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--tj-ink)] transition-colors"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label="Remove photo"
                  className="flex-1 py-1 font-[var(--tj-body)] text-xs text-[var(--tj-red)] hover:bg-[var(--tj-red)] hover:text-[var(--tj-cream)] transition-colors"
                >
                  ×
                </button>
              </div>
              {i === 0 && (
                <span className="absolute top-1 left-1 font-[var(--tj-body)] tracking-[0.15em] text-[0.55rem] uppercase font-semibold bg-[var(--tj-ink)] text-[var(--tj-cream)] px-1.5 py-0.5">
                  Hero
                </span>
              )}
              {slot.kind === 'new' && (
                <span className="absolute top-1 right-1 font-[var(--tj-body)] tracking-[0.15em] text-[0.55rem] uppercase font-semibold bg-[var(--tj-red)] text-[var(--tj-cream)] px-1.5 py-0.5">
                  New
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {photos.length < 5 ? (
        <input
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          onChange={(e) => {
            handlePicked(e.target.files)
            e.target.value = ''
          }}
          className="w-full text-sm font-serif file:mr-3 file:border-2 file:border-[var(--tj-ink)] file:bg-[var(--tj-cream)] file:px-3 file:py-2 file:font-[var(--tj-body)] file:tracking-[0.15em] file:text-[0.7rem] file:uppercase file:cursor-pointer hover:file:bg-[var(--tj-ink)] hover:file:text-[var(--tj-cream)]"
        />
      ) : (
        <p className="text-xs italic opacity-60">Maximum 5 photos.</p>
      )}
      {converting > 0 && (
        <p className="text-xs italic opacity-70">
          Converting {converting} HEIC {converting === 1 ? 'photo' : 'photos'} to JPEG…
        </p>
      )}
      {convertError && (
        <p className="text-xs italic text-[var(--tj-red)]">{convertError}</p>
      )}
    </div>
  )
}

/* ──────────────────────────  Confirm dialog  ────────────────────────── */

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmVariant,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  confirmVariant: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmBtn =
    confirmVariant === 'danger'
      ? 'border-[var(--tj-red)] bg-[var(--tj-red)] text-[var(--tj-cream)] hover:bg-transparent hover:text-[var(--tj-red)]'
      : 'border-[var(--tj-ink)] bg-[var(--tj-ink)] text-[var(--tj-cream)] hover:bg-transparent hover:text-[var(--tj-ink)]'
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-[var(--tj-ink)]/40"
      onClick={onCancel}
    >
      <div
        className="border-2 border-[var(--tj-ink)] bg-[var(--tj-cream)] p-6 max-w-sm w-full shadow-[0_8px_0_rgba(42,31,20,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-[var(--tj-body)] tracking-[0.22em] text-xs uppercase font-bold mb-3">
          {title}
        </h3>
        <p className="italic text-sm opacity-85 mb-5">{body}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="font-[var(--tj-body)] tracking-[0.22em] text-[0.7rem] uppercase font-semibold border-2 border-[var(--tj-ink)] px-4 py-2 hover:bg-[var(--tj-ink)] hover:text-[var(--tj-cream)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`font-[var(--tj-body)] tracking-[0.22em] text-[0.7rem] uppercase font-semibold border-2 px-4 py-2 transition-colors ${confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────  Field & picker  ────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="font-[var(--tj-body)] tracking-[0.2em] text-[0.7rem] uppercase block mb-1">
        {label}
      </span>
      {hint && <span className="block text-xs italic opacity-65 mb-2">{hint}</span>}
      {children}
    </label>
  )
}

function EncyclopediaPicker({
  encyclopedia,
  value,
  onChange,
}: {
  encyclopedia: EncyclopediaBag[]
  value: string
  onChange: (id: string) => void
}) {
  const grouped = useMemo(() => groupEncyclopedia(encyclopedia), [encyclopedia])
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full appearance-none border-2 border-[var(--tj-ink)] bg-[var(--tj-cream)] pl-3 pr-9 py-2.5 font-serif text-base outline-none focus:bg-white transition-colors"
      >
        <option value="">Pick a bag from the encyclopedia</option>
        {grouped.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.bags.map((bag) => (
              <option key={bag.id} value={bag.id}>
                {bagDisplayName(bag)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 10 6"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-2.5 h-1.5 opacity-60"
      >
        <path
          d="M1 1l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

/* ──────────────────────────  helpers  ────────────────────────── */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function bagDisplayName(bag: EncyclopediaBag): string {
  if (bag.region) return `${bag.region} (${bag.state ?? bag.stateCode ?? ''})`.trim()
  return bag.name
}

function groupEncyclopedia(
  encyclopedia: EncyclopediaBag[],
): { label: string; bags: EncyclopediaBag[] }[] {
  const order: { type: EncyclopediaBag['type']; label: string }[] = [
    { type: 'state', label: 'Locale Bags' },
    { type: 'special', label: 'Special Editions' },
    { type: 'standard', label: 'Standard Bags' },
  ]
  return order
    .map(({ type, label }) => ({
      label,
      bags: encyclopedia
        .filter((b) => b.type === type)
        .sort((a, b) => bagDisplayName(a).localeCompare(bagDisplayName(b))),
    }))
    .filter((g) => g.bags.length > 0)
}

function formatDate(iso: string): string {
  try {
    return parseLocalDate(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

function resolvePhotoUrl(path: string): string {
  if (path.startsWith('http')) return path
  return `${BASE}${path.replace(/^\//, '')}`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
