import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { EncyclopediaBag, PantryBag, Store } from '../types'
import {
  ANGLE_LABEL,
  ANGLE_ORDER,
  defaultReferencePhotos,
  inferAngleMap,
  photoUrl,
} from '../bagPhotos'

type DesignFields = NonNullable<EncyclopediaBag['design']>
import TopNav from '../TopNav'
import Footer from '../Footer'
import MaterialChips from '../MaterialChips'
import StoreChip from '../StoreChip'
import { useTitle } from '../useTitle'
import { parseLocalDate } from '../dates'

const BASE = import.meta.env.BASE_URL

/* ───────────────────────── PAGE ───────────────────────── */

type LoadedData = {
  encyclopedia: EncyclopediaBag[]
  pantry: PantryBag[]
  stores: Map<string, Store>
}

export default function BagDetail() {
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<LoadedData | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}data/encyclopedia.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<EncyclopediaBag[]>),
      fetch(`${BASE}data/pantry.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<PantryBag[]>),
      fetch(`${BASE}data/stores.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<Store[]>),
    ])
      .then(([encyclopedia, pantry, storeList]) => {
        setData({
          encyclopedia,
          pantry,
          stores: new Map(storeList.map((s) => [s.storeNumber, s])),
        })
      })
      .catch(() => setData({ encyclopedia: [], pantry: [], stores: new Map() }))
  }, [])

  const titleBag = data?.pantry.find((b) => b.slug === slug)
  const titleEncyclopedia = titleBag?.encyclopediaId
    ? data?.encyclopedia.find((c) => c.id === titleBag.encyclopediaId)
    : undefined
  useTitle(
    titleBag?.name ?? 'Bag',
    titleEncyclopedia?.description ?? titleBag?.memory,
    true,
  )

  if (!data) return <LoadingState />

  const bag = data.pantry.find((b) => b.slug === slug)
  if (!bag) return <NotLogged slug={slug} />

  const encyclopediaEntry = bag.encyclopediaId
    ? data.encyclopedia.find((c) => c.id === bag.encyclopediaId)
    : undefined
  const store = data.stores.get(bag.storeNumber)
  const design: DesignFields = encyclopediaEntry?.design ?? {}

  return <BagView bag={bag} encyclopediaEntry={encyclopediaEntry} store={store} design={design} />
}

/* ──────────────────────── VIEW ──────────────────────── */

function BagView({
  bag,
  encyclopediaEntry,
  store,
  design,
}: {
  bag: PantryBag
  encyclopediaEntry: EncyclopediaBag | undefined
  store: Store | undefined
  design: DesignFields
}) {
  // Two upload paths feed photos in: the curated encyclopedia convention
  // (filenames front/back/left/right/bottom, hand-named) and the Worker
  // upload flow (filenames like `{slug}-{randomId}.jpg`). Treat them
  // uniformly as a slide list — angle-tagged when filenames opt in,
  // otherwise plain ordered "Photo 1, Photo 2, …".
  // When Parker hasn't uploaded her own photos, fall back to the catalog's
  // front/back reference shots so the entry isn't blank. `usingReference`
  // flags the fallback so we can quietly label it as not-her-own.
  const usingReference = bag.photos.length === 0
  const slides = useMemo(
    () =>
      usingReference
        ? buildReferenceSlides(encyclopediaEntry)
        : buildSlides(bag.photos, design),
    [usingReference, bag.photos, design, encyclopediaEntry],
  )
  const [idx, setIdx] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Detect the first photo's natural aspect so the viewer panel can adapt to
  // it. A locked 4:5 box would letterbox very-tall (9:16) or very-wide (16:9)
  // photos into a small center band; matching the photo's aspect lets the
  // photo fill the panel. maxHeight caps super-tall photos so they don't
  // dominate the viewport.
  const [panelAspect, setPanelAspect] = useState<string>('4 / 5')
  useEffect(() => {
    const first = slides[0]
    if (!first) return
    const img = new Image()
    img.onload = () => {
      setPanelAspect(`${img.naturalWidth} / ${img.naturalHeight}`)
    }
    img.src = first.url
  }, [slides])

  const scrollToIdx = (i: number) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' })
  }

  const cycle = (dir: 1 | -1) => {
    if (slides.length < 2) return
    const next = (idx + dir + slides.length) % slides.length
    scrollToIdx(next)
  }

  // Sync the active idx with the scroll position so captions and the label-
  // button row track what the user swiped to.
  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el || el.clientWidth === 0) return
    const next = Math.round(el.scrollLeft / el.clientWidth)
    if (next !== idx && next >= 0 && next < slides.length) setIdx(next)
  }

  const active = slides[idx]
  const activeCaption = active?.caption

  const displayName = encyclopediaEntry?.region ?? encyclopediaEntry?.name ?? bag.name ?? bag.slug

  return (
    <main className="relative min-h-screen bg-[var(--tj-cream)] text-[var(--tj-ink)] overflow-hidden">
      <CrumpleOverlay />

      <div className="relative z-10 max-w-5xl mx-auto px-6 pt-6 pb-12 md:pt-8 md:pb-16">
        <TopNav />

        {/* Back to pantry — kraft microcopy, quiet but obvious. Sits above the
            two-column layout so the journal page feels like a stop along a
            path, not a destination in itself. */}
        <Link
          to="/pantry"
          className="inline-flex items-center gap-2 mt-6 font-[var(--tj-body)] tracking-[0.22em] text-[0.65rem] uppercase font-semibold opacity-65 hover:opacity-100 hover:text-[var(--tj-red)] transition-colors"
        >
          <img
            src={`${BASE}decor/icons/finger-point-left.svg`}
            alt=""
            aria-hidden
            className="h-3 w-auto opacity-80 select-none"
          />
          Back to the Pantry
        </Link>

        {/* Journal layout: photo column on the left, Parker's-side story on the
            right. Stacks on mobile. Deliberately diverges from the encyclopedia
            page — no big poetic subtitle, no "about this bag" blurb. */}
        <div className="grid md:grid-cols-2 gap-10 md:gap-14 mt-6 items-start">
          {/* LEFT — photo viewer */}
          <section>
            <div
              className="relative mx-auto bg-[var(--tj-cream-dark)] border-2 border-[var(--tj-ink)] overflow-hidden"
              style={{ aspectRatio: panelAspect, maxWidth: '360px', maxHeight: '72vh' }}
            >
              <PanelGrain />
              {slides.length > 0 ? (
                <div
                  ref={scrollerRef}
                  onScroll={handleScroll}
                  className="hide-scrollbar relative z-10 w-full h-full flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
                  style={{ touchAction: 'pan-x pan-y' }}
                >
                  {slides.map((s) => (
                    <div
                      key={s.url}
                      className="snap-start shrink-0 w-full h-full flex items-center justify-center p-6"
                    >
                      <img
                        src={s.url}
                        alt={`${displayName} bag, ${s.label.toLowerCase()}`}
                        className="max-w-full max-h-full object-contain"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative z-10 w-full h-full flex items-center justify-center text-[var(--tj-ink)]/30 text-4xl">
                  ✦
                </div>
              )}

              {slides.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => cycle(-1)}
                    aria-label="Previous photo"
                    className="absolute z-20 top-1/2 left-2 -translate-y-1/2 w-9 h-12 flex items-center justify-center bg-[var(--tj-ink)]/75 text-[var(--tj-cream)] hover:bg-[var(--tj-ink)] transition-colors text-xl border-2 border-[var(--tj-ink)] leading-none"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => cycle(1)}
                    aria-label="Next photo"
                    className="absolute z-20 top-1/2 right-2 -translate-y-1/2 w-9 h-12 flex items-center justify-center bg-[var(--tj-ink)]/75 text-[var(--tj-cream)] hover:bg-[var(--tj-ink)] transition-colors text-xl border-2 border-[var(--tj-ink)] leading-none"
                  >
                    ›
                  </button>
                </>
              )}
            </div>

            {activeCaption && (
              <p className="text-center italic mt-4 mx-auto max-w-sm opacity-80 text-sm leading-relaxed">
                {activeCaption}
              </p>
            )}

            {usingReference && slides.length > 0 && (
              <p className="text-center mt-4 font-[var(--tj-body)] tracking-[0.22em] text-[0.6rem] uppercase font-semibold opacity-50">
                Catalog reference photo · Parker’s own coming soon
              </p>
            )}

            {slides.length > 1 && (
              <div className="flex justify-center gap-2 mt-5 flex-wrap">
                {slides.map((s, i) => {
                  const isActive = i === idx
                  return (
                    <button
                      key={s.url}
                      type="button"
                      onClick={() => scrollToIdx(i)}
                      className={`font-[var(--tj-body)] font-semibold tracking-[0.2em] text-[0.65rem] uppercase border-2 border-[var(--tj-ink)] px-3 py-1.5 transition-colors ${
                        isActive
                          ? 'bg-[var(--tj-ink)] text-[var(--tj-cream)]'
                          : 'bg-transparent text-[var(--tj-ink)] hover:bg-[var(--tj-ink)]/10'
                      }`}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* RIGHT — journal-side info */}
          <section className="flex flex-col gap-8">
            {/* Name — the type is kept as a quiet label so the personal
                content below carries the visual weight. */}
            <header>
              <p className="font-[var(--tj-body)] tracking-[0.4em] text-[0.7rem] uppercase font-semibold opacity-55 mb-3">
                {encyclopediaTypeLabel(encyclopediaEntry)}
              </p>

              <h1
                className="text-[var(--tj-red)] text-5xl md:text-6xl leading-none"
                style={{ fontFamily: 'var(--tj-script)' }}
              >
                {displayName}
              </h1>
            </header>

            {/* When & where — a journal-style dateline leading the entry. */}
            <dl className="border-t border-[var(--tj-ink)]/30 pt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <dt className="font-[var(--tj-body)] tracking-[0.3em] text-[0.6rem] uppercase font-bold opacity-55 mb-2">
                  Acquired
                </dt>
                <dd className="font-[var(--tj-body)] text-base">
                  {formatDate(bag.dateAcquired)}
                </dd>
              </div>
              <div>
                <dt className="font-[var(--tj-body)] tracking-[0.3em] text-[0.6rem] uppercase font-bold opacity-55 mb-2">
                  Found at
                </dt>
                <dd className="text-sm">
                  <StoreChip storeNumber={bag.storeNumber} store={store} />
                </dd>
              </div>
            </dl>

            {/* Parker's note — the centerpiece, landing after the dateline. */}
            {bag.memory && (
              <div className="border-t border-[var(--tj-ink)]/30 pt-6">
                <h2 className="font-[var(--tj-body)] tracking-[0.3em] text-[0.7rem] uppercase font-bold mb-3 opacity-70">
                  Parker’s note
                </h2>
                <p className="italic text-lg md:text-xl leading-relaxed border-l-2 border-[var(--tj-red)]/50 pl-4">
                  “{bag.memory}”
                </p>
              </div>
            )}

            {/* Catalog cross-reference — materials + the encyclopedia link,
                demoted to a quiet footer beneath the personal details. */}
            <div className="border-t border-[var(--tj-ink)]/20 pt-6 flex flex-col gap-4">
              <MaterialChips materials={encyclopediaEntry?.materials} />
              {encyclopediaEntry && (
                <Link
                  to={`/encyclopedia/${encyclopediaEntry.id}`}
                  className="inline-flex items-center gap-2 font-[var(--tj-body)] tracking-[0.22em] text-[0.65rem] uppercase font-semibold underline-offset-4 hover:underline opacity-70 hover:opacity-100"
                >
                  See this bag in the encyclopedia
                  <span aria-hidden>→</span>
                </Link>
              )}
            </div>
          </section>
        </div>
      </div>

      <Footer />
    </main>
  )
}

/* ──────────────────────── HELPERS ──────────────────────── */

type Slide = { url: string; label: string; caption?: string }

function buildSlides(photos: string[], design: DesignFields): Slide[] {
  const angleMap = inferAngleMap(photos)
  const angled = ANGLE_ORDER.filter((a) => angleMap[a])
  // Use angle navigation only when every photo opted in to the
  // front/back/left/right/bottom naming convention. Mixed sets fall
  // through to ordered navigation so no photo gets dropped.
  if (angled.length > 0 && angled.length === photos.length) {
    return angled.map((a) => ({
      url: photoUrl(angleMap[a]!),
      label: ANGLE_LABEL[a],
      caption: design.angleCaptions?.[a],
    }))
  }
  return photos.map((p, i) => ({ url: photoUrl(p), label: `${i + 1}` }))
}

// Fallback slides drawn from the encyclopedia's reference photos when Parker
// has no photos of her own — just the front and back so the diary stays
// lighter than the full-angle encyclopedia viewer.
function buildReferenceSlides(entry: EncyclopediaBag | undefined): Slide[] {
  if (!entry) return []
  const refs = defaultReferencePhotos(entry)
  const angleMap = inferAngleMap(refs)
  const slides = (['front', 'back'] as const)
    .filter((a) => angleMap[a])
    .map((a) => ({ url: photoUrl(angleMap[a]!), label: ANGLE_LABEL[a] }))
  // If the reference photos don't follow the front/back naming, show the
  // first couple in order rather than nothing.
  if (slides.length) return slides
  return refs.slice(0, 2).map((p, i) => ({ url: photoUrl(p), label: `${i + 1}` }))
}

function encyclopediaTypeLabel(entry: EncyclopediaBag | undefined): string {
  if (!entry) return 'Unencyclopediaed Bag'
  if (entry.type === 'state') return `${entry.state ?? 'State'} ★ State Bag`
  if (entry.type === 'special') return 'Special Edition'
  return 'Standard Bag'
}

function formatDate(iso: string): string {
  try {
    return parseLocalDate(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

/* ──────────────────────── PIECES ──────────────────────── */

function LoadingState() {
  return (
    <main className="relative min-h-screen bg-[var(--tj-cream)] text-[var(--tj-ink)] flex items-center justify-center">
      <p className="italic opacity-50">Unpacking the bag…</p>
    </main>
  )
}

function NotLogged({ slug }: { slug?: string }) {
  return (
    <main className="relative min-h-screen bg-[var(--tj-cream)] text-[var(--tj-ink)] overflow-hidden">
      <CrumpleOverlay />
      <div className="relative z-10 max-w-2xl mx-auto px-6 py-16 text-center">
        <TopNav />
        <p className="font-[var(--tj-body)] tracking-[0.4em] text-xs uppercase font-semibold border border-[var(--tj-ink)] inline-block px-4 py-1.5 mb-6">
          Not Yet Logged
        </p>
        <h1
          className="text-[var(--tj-red)] text-6xl md:text-7xl leading-none"
          style={{ fontFamily: 'var(--tj-script)' }}
        >
          {slug ?? 'Unknown Bag'}
        </h1>
        <p className="italic mt-6 opacity-70">
          Parker hasn’t added this bag to the pantry yet. Browse the{' '}
          <Link to="/pantry" className="underline underline-offset-4">
            pantry
          </Link>{' '}
          to see what’s logged so far, or{' '}
          <Link to="/encyclopedia" className="underline underline-offset-4">
            the encyclopedia
          </Link>{' '}
          for every Trader Joe’s bag we know about.
        </p>
      </div>
    </main>
  )
}

/* Lighter crumple overlay, same as Pantry / Encyclopedia. */
function CrumpleOverlay() {
  return (
    <svg
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none mix-blend-multiply opacity-50"
    >
      <defs>
        <filter id="paperCrumpleBagDetail" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" seed="9" />
          <feColorMatrix
            type="matrix"
            values="
              0 0 0 0 0.20
              0 0 0 0 0.14
              0 0 0 0 0.08
              0 0 0 0.40 0"
          />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#paperCrumpleBagDetail)" />
    </svg>
  )
}

/* Subtle paper grain inside the bag-display panel. */
function PanelGrain() {
  return (
    <svg
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none mix-blend-multiply opacity-25"
    >
      <defs>
        <filter id="panelGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="3" />
          <feColorMatrix
            type="matrix"
            values="
              0 0 0 0 0.22
              0 0 0 0 0.16
              0 0 0 0 0.10
              0 0 0 0.30 0"
          />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#panelGrain)" />
    </svg>
  )
}
