import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import type {
  BagType,
  CategoryVisibility,
  EncyclopediaBag,
  PantryBag,
  ProgressStats,
  Store,
} from '../types'
import { DEFAULT_VISIBILITY } from '../types'
import TopNav from '../TopNav'
import Footer from '../Footer'
import StoreChip from '../StoreChip'
import { defaultReferencePhotos } from '../bagPhotos'
import { US_LOCALES } from '../usLocales'
import { useTitle } from '../useTitle'

const BASE = import.meta.env.BASE_URL
const STATE_NAME_BY_CODE = new Map(US_LOCALES.map((l) => [l.code, l.name]))

type SortOrder = 'newest' | 'oldest'
type TypeFilter = ReadonlySet<BagType>

export default function Pantry() {
  useTitle(
    'Pantry',
    "Parker's logged Trader Joe's tote collection — every bag found in the wild, with the store and date each was acquired.",
    true,
  )
  const [bags, setBags] = useState<PantryBag[] | null>(null)
  const [stores, setStores] = useState<Map<string, Store>>(new Map())
  const [encyclopediaById, setEncyclopediaById] = useState<Map<string, EncyclopediaBag>>(new Map())
  const [stats, setStats] = useState<ProgressStats | null>(null)
  const [visibility, setVisibility] = useState<CategoryVisibility>(DEFAULT_VISIBILITY)
  const [sort, setSort] = useState<SortOrder>('newest')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => new Set())

  function toggleType(t: BagType) {
    setTypeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function clearTypes() {
    setTypeFilter(new Set())
  }
  const [query, setQuery] = useState('')

  // Mock-data toggle: visiting /pantry?mock=1 swaps the pantry source to
  // public/data/pantry-mock.json so we can preview the frame system across
  // varied photo aspects without touching the real pantry. useLocation makes
  // this reactive to SPA navigations (otherwise the effect wouldn't re-run
  // when the query string toggles).
  const location = useLocation()
  const isMock = new URLSearchParams(location.search).has('mock')
  const pantryUrl = `${BASE}data/${isMock ? 'pantry-mock.json' : 'pantry.json'}`

  // Plaque color scheme — try ?plaque=slate | navy | brown in the URL to
  // preview each option. Default is navy (best contrast with the red script).
  const plaqueScheme = new URLSearchParams(location.search).get('plaque') ?? 'navy'
  const plaqueBg =
    plaqueScheme === 'slate' ? '#3a3d44' : plaqueScheme === 'brown' ? '#3a2418' : '#1c2640'

  useEffect(() => {
    Promise.all([
      fetch(pantryUrl, { cache: 'no-cache' }).then((r) => r.json() as Promise<PantryBag[]>),
      fetch(`${BASE}data/stores.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<Store[]>),
      fetch(`${BASE}data/encyclopedia.json`, { cache: 'no-cache' }).then((r) => r.json() as Promise<EncyclopediaBag[]>),
    ])
      .then(([pantry, storeList, encyclopedia]) => {
        setBags(pantry)
        setStores(new Map(storeList.map((s) => [s.storeNumber, s])))

        const byId = new Map(encyclopedia.map((b) => [b.id, b]))
        setEncyclopediaById(byId)

        const totals: Record<BagType, number> = { state: 0, special: 0, standard: 0 }
        for (const bag of encyclopedia) totals[bag.type]++

        const collected: Record<BagType, number> = { state: 0, special: 0, standard: 0 }
        for (const bag of pantry) {
          if (!bag.encyclopediaId) continue
          const entry = byId.get(bag.encyclopediaId)
          if (!entry) continue
          collected[entry.type]++
        }

        setStats({
          totalBags: pantry.length,
          byType: {
            state: { collected: collected.state, total: totals.state },
            special: { collected: collected.special, total: totals.special },
            standard: { collected: collected.standard, total: totals.standard },
          },
        })
      })
      .catch(() => setBags([]))

    // Missing visibility.json just means "show everything" — defaults cover it.
    fetch(`${BASE}data/visibility.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<CategoryVisibility>) : null))
      .then((v) => {
        if (v) setVisibility({ ...DEFAULT_VISIBILITY, ...v })
      })
      .catch(() => {
        /* keep defaults */
      })
  }, [pantryUrl])

  const availableTypes = useMemo(() => {
    if (!bags) return [] as BagType[]
    const present = new Set<BagType>()
    for (const bag of bags) {
      if (!bag.encyclopediaId) continue
      const entry = encyclopediaById.get(bag.encyclopediaId)
      if (entry && visibility[entry.type]) present.add(entry.type)
    }
    return TYPE_ORDER.filter((t) => present.has(t))
  }, [bags, encyclopediaById, visibility])

  const displayTypes = useMemo(() => TYPE_ORDER.filter((t) => visibility[t]), [visibility])

  const filteredBags = useMemo(() => {
    if (!bags) return [] as PantryBag[]
    const q = query.trim().toLowerCase()
    const matches = bags.filter((bag) => {
      const entry = bag.encyclopediaId ? encyclopediaById.get(bag.encyclopediaId) : undefined
      if (entry && !visibility[entry.type]) return false
      if (typeFilter.size > 0 && (!entry || !typeFilter.has(entry.type))) return false
      if (!q) return true
      const store = stores.get(bag.storeNumber)
      const storeStateName = store ? STATE_NAME_BY_CODE.get(store.state) ?? '' : ''
      const haystack = [
        bag.name ?? '',
        bag.memory ?? '',
        entry?.name ?? '',
        entry?.state ?? '',
        entry?.stateCode ?? '',
        entry?.region ?? '',
        store?.name ?? '',
        store?.city ?? '',
        store?.state ?? '',
        storeStateName,
        store?.storeNumber ?? '',
        store?.streetAddress ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
    const sorted = [...matches].sort((a, b) => {
      const diff = new Date(b.dateAcquired).getTime() - new Date(a.dateAcquired).getTime()
      return sort === 'newest' ? diff : -diff
    })
    return sorted
  }, [bags, encyclopediaById, stores, typeFilter, query, sort, visibility])

  const filtersActive = typeFilter.size > 0 || query.trim() !== ''

  // Bags Parker hasn't hidden via Settings visibility. Used as the denominator
  // in "Showing X of Y" so hidden-category bags don't inflate Y.
  const visibleTotalCount = useMemo(() => {
    if (!bags) return 0
    return bags.filter((bag) => {
      const entry = bag.encyclopediaId ? encyclopediaById.get(bag.encyclopediaId) : undefined
      return !entry || visibility[entry.type]
    }).length
  }, [bags, encyclopediaById, visibility])

  function clearFilters() {
    clearTypes()
    setQuery('')
  }

  // Detect each bag's hero photo aspect (W/H) once. Used by the round-robin
  // frame picker below so landscape photos land on landscape frames, etc.
  const [photoAspects, setPhotoAspects] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    if (!bags) return
    for (const bag of bags) {
      const heroSrc = heroSrcFor(bag, encyclopediaById)
      if (!heroSrc) continue
      if (photoAspects.has(heroSrc)) continue
      const url = resolvePhotoUrl(heroSrc)
      if (!url) continue
      const img = new Image()
      img.onload = () => {
        const a = img.naturalWidth / img.naturalHeight
        setPhotoAspects((prev) => {
          if (prev.has(heroSrc)) return prev
          const next = new Map(prev)
          next.set(heroSrc, a)
          return next
        })
      }
      img.src = url
    }
  }, [bags, photoAspects, encyclopediaById])

  // Assign each bag a frame using least-used-from-compatible-set. Iterates in
  // display order (newest first) so the most recent bags get first pick of
  // unique frames. Recomputes when bags or aspect data changes.
  //
  // When the photo's aspect is outside every frame's compatibility tolerance
  // (e.g. 9:16 phone video), we pick the closest-aspect frame from the top 3
  // candidates and tag it with `stretchTo` — BagCard then sets the container
  // aspect to the photo's actual aspect, distorting the frame slightly so the
  // photo fits cleanly. Every photo gets a usable frame.
  type Assignment = { frame: FrameDef; stretchTo: number | null }
  const frameAssignment = useMemo(() => {
    const assignment = new Map<string, Assignment>()
    if (!bags) return assignment
    const usage = new Map<string, number>()
    const tolerance = 0.3
    const ordered = [...bags].sort(
      (a, b) => new Date(b.dateAcquired).getTime() - new Date(a.dateAcquired).getTime(),
    )
    for (const bag of ordered) {
      const override = BAG_OVERRIDES[bag.slug]
      if (override?.frame) {
        const forced = BAG_FRAMES.find((f) => f.file === override.frame)
        if (forced) {
          assignment.set(bag.slug, { frame: forced, stretchTo: null })
          usage.set(forced.file, (usage.get(forced.file) ?? 0) + 1)
          continue
        }
      }
      const heroSrc = heroSrcFor(bag, encyclopediaById)
      const aspect = heroSrc ? photoAspects.get(heroSrc) : undefined

      let pool: FrameDef[]
      let stretchTo: number | null = null
      if (aspect !== undefined) {
        // First try frames within aspect tolerance (no stretch needed).
        const compatible = BAG_FRAMES.filter(
          (f) =>
            f.photoAspect !== undefined &&
            Math.abs(Math.log(f.photoAspect / aspect)) < tolerance,
        )
        if (compatible.length > 0) {
          pool = compatible
        } else {
          // No compatible frame: take the top 3 closest by aspect, then stretch.
          pool = [...BAG_FRAMES]
            .filter((f) => f.photoAspect !== undefined)
            .sort(
              (a, b) =>
                Math.abs(Math.log(a.photoAspect! / aspect)) -
                Math.abs(Math.log(b.photoAspect! / aspect)),
            )
            .slice(0, 3)
          stretchTo = aspect
        }
      } else {
        pool = BAG_FRAMES
      }

      // Pick the least-used frame in this pool; ties broken by pool order.
      let best = pool[0]
      let bestCount = usage.get(best.file) ?? 0
      for (const f of pool) {
        const c = usage.get(f.file) ?? 0
        if (c < bestCount) {
          best = f
          bestCount = c
        }
      }
      assignment.set(bag.slug, { frame: best, stretchTo })
      usage.set(best.file, (usage.get(best.file) ?? 0) + 1)
    }
    return assignment
  }, [bags, photoAspects, encyclopediaById])

  // Row-major masonry: deal sorted bags across N columns round-robin (card i ->
  // column i % N) so they read left-to-right, top-to-bottom, tightly packed.
  const columnCount = useColumnCount()
  const columns = useMemo(() => {
    const cols: PantryBag[][] = Array.from({ length: columnCount }, () => [])
    filteredBags.forEach((bag, i) => {
      cols[i % columnCount].push(bag)
    })
    return cols
  }, [filteredBags, columnCount])

  return (
    <main
      id="pantry"
      className="relative min-h-screen bg-[var(--tj-cream)] text-[var(--tj-ink)] px-6 pt-6 md:pt-8 overflow-hidden"
    >
      <CrumpleOverlay />

      {isMock && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-[var(--tj-red)] text-[var(--tj-cream)] font-[var(--tj-body)] font-semibold tracking-[0.25em] text-[0.65rem] uppercase px-3 py-1.5 border-2 border-[var(--tj-ink)] shadow-[0_3px_0_rgba(42,31,20,0.2)] pointer-events-none">
          Mock Data
        </div>
      )}

      <div className="relative z-10 max-w-6xl mx-auto">
        <TopNav />

        <header className="text-center mb-14">
          <p className="font-[var(--tj-body)] tracking-[0.4em] text-xs uppercase font-semibold border border-[var(--tj-ink)] inline-block px-4 py-1.5 mb-6">
            Parker's Pantry
          </p>
          <h1
            className="text-[var(--tj-red)] text-6xl md:text-7xl leading-none"
            style={{ fontFamily: 'var(--tj-script)' }}
          >
            The Whole Haul
          </h1>
          <p className="font-[var(--tj-body)] italic text-base md:text-lg mt-4 max-w-xl mx-auto opacity-75">
            Behold: Trader Parker's ever-growing collection of bags, intrepidly brought home from many a valiant expedition to the local Trader Joe's.
          </p>
          <div className="mx-auto mt-6 h-px w-32 bg-[var(--tj-ink)]/40" />
        </header>

        {stats && <StatsRow stats={stats} visibility={visibility} />}

        {bags === null && <LoadingState />}
        {bags && bags.length === 0 && <EmptyState />}
        {bags && bags.length > 0 && (
          <>
            <FilterBar
              availableTypes={availableTypes}
              displayTypes={displayTypes}
              typeFilter={typeFilter}
              onToggleType={toggleType}
              onClearTypes={clearTypes}
              query={query}
              onQuery={setQuery}
              sort={sort}
              onSort={setSort}
              visibleCount={filteredBags.length}
              totalCount={visibleTotalCount}
              filtersActive={filtersActive}
            />
            {filteredBags.length === 0 ? (
              <NoMatchesState onClear={clearFilters} />
            ) : (
              <div className="flex items-start gap-x-4 md:gap-x-5">
                {columns.map((col, ci) => (
                  <div key={ci} className="flex-1 min-w-0">
                    {col.map((bag) => {
                      const assigned = frameAssignment.get(bag.slug)
                      return (
                        <div key={bag.slug} className="mb-6 md:mb-8">
                          <BagCard
                            bag={bag}
                            store={stores.get(bag.storeNumber)}
                            encyclopediaEntry={
                              bag.encyclopediaId ? encyclopediaById.get(bag.encyclopediaId) : undefined
                            }
                            assignedFrame={assigned?.frame}
                            stretchTo={assigned?.stretchTo ?? null}
                            plaqueBg={plaqueBg}
                          />
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Footer />
    </main>
  )
}

/* Lighter version of the landing's crumple — same filter, less opacity so
   it reads as gentle paper grain over the cream background. */
function CrumpleOverlay() {
  return (
    <svg
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none mix-blend-multiply opacity-50"
    >
      <defs>
        <filter id="paperCrumpleLight" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015"
            numOctaves="3"
            seed="5"
          />
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
      <rect width="100%" height="100%" filter="url(#paperCrumpleLight)" />
    </svg>
  )
}

const CATEGORY_STAT_ORDER: { key: BagType; label: string }[] = [
  { key: 'state', label: 'States & Cities' },
  { key: 'special', label: 'Special Editions' },
  { key: 'standard', label: 'Standard Bags' },
]

// Focal single-category stat: a long bar with the count and percentage counting
// up in sync as it fills. Re-runs on hover. One rAF drives progress 0→1 so the
// number, percentage, and bar width stay locked together.
function FeaturedStat({
  label,
  collected,
  total,
}: {
  label: string
  collected: number
  total: number
}) {
  const target = total > 0 ? Math.min(100, (collected / total) * 100) : 0
  const [progress, setProgress] = useState(0)
  const [runId, setRunId] = useState(0)

  useEffect(() => {
    setProgress(0)
    let raf = 0
    let start: number | null = null
    const tick = (t: number) => {
      if (start === null) start = t
      const p = Math.min(1, (t - start) / 1200)
      setProgress(1 - Math.pow(1 - p, 3))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [runId])

  const count = Math.round(progress * collected)
  const pct = Math.round(progress * target)

  return (
    <section
      aria-label={`${label} progress`}
      onMouseEnter={() => setRunId((r) => r + 1)}
      className="mb-16 mt-2 mx-auto w-full max-w-[33.6rem] border-y-2 border-[var(--tj-ink)] px-4 py-8 text-center"
    >
      <p className="font-[var(--tj-body)] tracking-[0.35em] text-[0.7rem] uppercase font-semibold opacity-60 mb-5">
        {label}
      </p>
      <div className="flex items-baseline justify-center gap-2 mb-6">
        <span className="text-6xl md:text-7xl leading-none font-bold text-[var(--tj-red)] tabular-nums">
          {count}
        </span>
        <span className="text-2xl md:text-3xl leading-none font-[var(--tj-body)] text-[var(--tj-ink)] opacity-75 tabular-nums">
          / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(target)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-3 w-full bg-[var(--tj-ink)]/15 overflow-hidden"
      >
        <div className="h-full bg-[var(--tj-red)]" style={{ width: `${progress * target}%` }} />
      </div>
      <p className="mt-4 font-[var(--tj-body)] tracking-[0.25em] text-xs uppercase opacity-60 tabular-nums">
        {pct}% collected
      </p>
    </section>
  )
}

function StatsRow({
  stats,
  visibility,
}: {
  stats: ProgressStats
  visibility: CategoryVisibility
}) {
  const visibleCategories = CATEGORY_STAT_ORDER.filter(({ key }) => visibility[key])
  type Cell = {
    key: string
    value: string
    label: string
    collected?: number
    total?: number
  }
  const showTotal = visibleCategories.length >= 2
  const cells: Cell[] = [
    ...(showTotal
      ? [{ key: 'totalBags', value: String(stats.totalBags), label: 'In the Pantry' }]
      : []),
    ...visibleCategories.map(({ key, label }) => {
      const { collected, total } = stats.byType[key]
      return {
        key,
        value: `${collected}/${total || '—'}`,
        label,
        collected,
        total,
      }
    }),
  ]

  const single = cells.length === 1 ? cells[0] : null
  if (single && single.collected != null && single.total != null) {
    return (
      <FeaturedStat label={single.label} collected={single.collected} total={single.total} />
    )
  }

  return (
    <div className="mb-12 mx-auto w-fit max-w-full border-y-2 border-[var(--tj-ink)] font-[var(--tj-body)] font-semibold tracking-[0.18em] text-sm">
      {/* Mobile: vertical stack with horizontal dividers, full-width bars. */}
      <div className="sm:hidden flex flex-col divide-y-2 divide-[var(--tj-ink)] w-[20rem] max-w-[88vw] mx-auto">
        {cells.map((cell) => (
          <div key={cell.key} className="py-4 px-6">
            <Stat
              value={cell.value}
              label={cell.label}
              collected={cell.collected}
              total={cell.total}
            />
          </div>
        ))}
      </div>

      {/* sm and up: horizontal row with vertical dividers. */}
      <div className="hidden sm:flex flex-wrap items-stretch justify-center gap-x-8 gap-y-4 py-4 px-6">
        {cells.map((cell, i) => (
          <div key={cell.key} className="flex items-stretch gap-8">
            {i > 0 && <div className="w-px self-stretch bg-[var(--tj-ink)]" aria-hidden />}
            <Stat
              value={cell.value}
              label={cell.label}
              collected={cell.collected}
              total={cell.total}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({
  value,
  label,
  collected,
  total,
}: {
  value: string
  label: string
  collected?: number
  total?: number
}) {
  const hasProgress = typeof collected === 'number' && typeof total === 'number' && total > 0
  return (
    <div className="text-center min-w-[6.5rem]">
      <strong className="block text-3xl leading-none text-[var(--tj-red)] font-bold tracking-normal">
        {value}
      </strong>
      <span className="text-[0.7rem]">{label.toUpperCase()}</span>
      {hasProgress && <ProgressBar collected={collected!} total={total!} label={label} />}
    </div>
  )
}

/* Thin progress bar that eases from 0% → (collected/total)% on mount.
   We delay one frame after mounting so the browser sees the transition
   from 0 — setting the target value synchronously would skip the anim. */
function ProgressBar({
  collected,
  total,
  label,
}: {
  collected: number
  total: number
  label: string
}) {
  const target = total > 0 ? Math.min(100, Math.round((collected / total) * 100)) : 0
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(target))
    return () => cancelAnimationFrame(id)
  }, [target])

  return (
    <div className="mt-2">
      <div
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuenow={target}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full bg-[var(--tj-ink)]/15 overflow-hidden"
      >
        <div
          className="h-full bg-[var(--tj-red)]"
          style={{
            width: `${width}%`,
            transition: 'width 1200ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>
      <span className="block mt-1 text-[0.6rem] tracking-[0.15em] opacity-60">
        {target}%
      </span>
    </div>
  )
}

const TYPE_ORDER: BagType[] = ['state', 'special', 'standard']
const TYPE_PILL_LABEL: Record<BagType, string> = {
  state: 'States',
  special: 'Specials',
  standard: 'Standard',
}

function FilterBar({
  availableTypes,
  displayTypes,
  typeFilter,
  onToggleType,
  onClearTypes,
  query,
  onQuery,
  sort,
  onSort,
  visibleCount,
  totalCount,
  filtersActive,
}: {
  availableTypes: BagType[]
  displayTypes: BagType[]
  typeFilter: TypeFilter
  onToggleType: (t: BagType) => void
  onClearTypes: () => void
  query: string
  onQuery: (v: string) => void
  sort: SortOrder
  onSort: (v: SortOrder) => void
  visibleCount: number
  totalCount: number
  filtersActive: boolean
}) {
  const isFilterable = availableTypes.length >= 2
  const showTypeRow = displayTypes.length >= 2
  return (
    <div className="max-w-[720px] mx-auto mb-10 space-y-4">
      {showTypeRow && (
        <div
          role="group"
          aria-label={
            isFilterable ? 'Filter by type — toggle any combination' : 'Bag types in this collection'
          }
          className="flex flex-wrap items-center justify-center gap-2"
        >
        {isFilterable && (
          <TypePill active={typeFilter.size === 0} onClick={onClearTypes}>
            All
          </TypePill>
        )}
        {displayTypes.map((t) => {
          const disabled = !availableTypes.includes(t)
          const asCurrent = !isFilterable && !disabled
          return (
            <TypePill
              key={t}
              active={asCurrent || typeFilter.has(t)}
              onClick={() => onToggleType(t)}
              checkable
              disabled={disabled}
              readOnly={asCurrent}
            >
              {TYPE_PILL_LABEL[t]}
            </TypePill>
          )
        })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <label className="flex-1 min-w-[14rem] max-w-md">
          <span className="sr-only">Search the pantry</span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search memories, places, stores, states…"
            className="w-full border-2 border-[var(--tj-ink)] bg-[var(--tj-cream)] px-3 py-2 font-[var(--tj-body)] text-sm outline-none focus:bg-white"
          />
        </label>
        <label className="flex items-center gap-2 font-[var(--tj-body)] tracking-[0.2em] text-[0.7rem] uppercase font-semibold">
          <span className="opacity-60">Sort</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortOrder)}
            className="border-2 border-[var(--tj-ink)] bg-[var(--tj-cream)] px-2 py-2 font-[var(--tj-body)] tracking-[0.15em] text-[0.7rem] uppercase font-semibold cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      {filtersActive && (
        <p className="text-center font-[var(--tj-body)] italic text-sm opacity-65">
          Showing {visibleCount} of {totalCount}
        </p>
      )}
    </div>
  )
}

function TypePill({
  active,
  onClick,
  checkable = false,
  disabled = false,
  readOnly = false,
  children,
}: {
  active: boolean
  onClick: () => void
  /** Render with a checkbox indicator and use aria-pressed instead of the
      "All" pill's plain-button semantics. Signals the user can toggle on/off. */
  checkable?: boolean
  disabled?: boolean
  readOnly?: boolean
  children: React.ReactNode
}) {
  const interactive = !disabled && !readOnly
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={checkable && !disabled ? active : undefined}
      aria-current={readOnly ? 'true' : undefined}
      onClick={interactive ? onClick : undefined}
      className={`inline-flex items-center gap-1.5 font-[var(--tj-body)] tracking-[0.18em] sm:tracking-[0.22em] text-[0.65rem] sm:text-[0.7rem] uppercase font-semibold px-3 sm:px-3.5 py-1.5 sm:py-2 border-2 transition-colors ${
        disabled
          ? 'bg-[var(--tj-ink)]/10 border-[var(--tj-ink)]/30 text-[var(--tj-ink)]/40 cursor-not-allowed'
          : active
            ? 'bg-[var(--tj-ink)] border-[var(--tj-ink)] text-[var(--tj-cream)]'
            : 'bg-[var(--tj-cream)] border-[var(--tj-ink)] hover:bg-[var(--tj-ink)]/10'
      } ${readOnly ? 'cursor-default' : ''}`}
    >
      {checkable && (
        <span
          aria-hidden
          className={`inline-flex items-center justify-center w-3.5 h-3.5 border-2 transition-colors ${
            disabled
              ? 'border-[var(--tj-ink)]/30 text-transparent'
              : active
                ? 'border-[var(--tj-cream)] bg-[var(--tj-cream)] text-[var(--tj-ink)]'
                : 'border-[var(--tj-ink)] text-transparent'
          }`}
        >
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5">
            <path
              d="M2 6.5l2.5 2.5L10 3"
              stroke="currentColor"
              strokeWidth="1.75"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
      {children}
    </button>
  )
}

function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="max-w-md mx-auto text-center py-12 border-2 border-dashed border-[var(--tj-ink)]/40 p-10 bg-[var(--tj-kraft)]/15">
      <img
        src={`${BASE}decor/icons/magnifying-glass.svg`}
        alt=""
        aria-hidden
        className="mx-auto h-20 w-auto mb-4 opacity-80 select-none"
      />
      <h3 className="font-[var(--tj-body)] tracking-[0.25em] text-sm uppercase font-bold mb-3">
        Nothing in Stock
      </h3>
      <p className="italic text-sm mb-6">
        Alas! No bags match those particulars. Tweak the filters, or clear the search to start anew.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="inline-block font-[var(--tj-body)] font-semibold tracking-[0.25em] text-xs uppercase border-2 border-[var(--tj-ink)] bg-[var(--tj-ink)] text-[var(--tj-cream)] px-5 py-2.5 hover:-translate-y-0.5 transition-transform"
      >
        Clear Filters
      </button>
    </div>
  )
}

function LoadingState() {
  return (
    <p className="text-center italic opacity-50 py-20">Unpacking the bags…</p>
  )
}

function EmptyState() {
  return (
    <div className="max-w-md mx-auto text-center py-12 border-2 border-dashed border-[var(--tj-ink)]/40 p-10 bg-[var(--tj-kraft)]/15">
      <img
        src={`${BASE}decor/icons/shopping_bag.svg`}
        alt=""
        aria-hidden
        className="mx-auto h-20 w-auto mb-4 opacity-80 select-none"
      />
      <h3 className="font-[var(--tj-body)] tracking-[0.25em] text-sm uppercase font-bold mb-3">
        No Bags Logged Yet
      </h3>
      <p className="italic text-sm mb-6">
        Parker hasn't added any bags to the pantry. <br />
        First one's just a click away.
      </p>
      <Link
        to="/admin"
        className="inline-block font-[var(--tj-body)] font-semibold tracking-[0.25em] text-xs uppercase border-2 border-[var(--tj-ink)] bg-[var(--tj-ink)] text-[var(--tj-cream)] px-5 py-2.5 hover:-translate-y-0.5 transition-transform"
      >
        Log the First Bag
      </Link>
    </div>
  )
}

// Vintage frame variants. Aspect matches each SVG's viewBox so the frame
// renders to true scale; inset defines where the frame's hollow center sits
// so the photo can be inset behind it. Frame is picked deterministically
// from the bag slug so each bag always gets the same one across reloads.
export type FrameDef = {
  file: string
  aspect: string
  inset: { top: string; right: string; bottom: string; left: string }
  /**
   * Optional CSS rotation applied to the frame img (degrees, clockwise).
   * `aspect` and `inset` describe the FINAL displayed container, so the
   * rotation just rotates the SVG visually. For 90/270 the frame img is
   * sized via CSS container queries so it fills the container after rotation.
   */
  rotate?: 0 | 90 | 180 | 270
  /**
   * Photo aspect ratio (W/H) this frame is tuned for. Used by the aspect-aware
   * picker so an uploaded landscape photo automatically lands on a landscape
   * frame, portrait on a portrait frame, etc. ~1.33 = 4:3 horizontal,
   * ~0.75 = 3:4 portrait, ~1.78 = 16:9, etc.
   */
  photoAspect?: number
}
// Inset values are measured by `scripts/measure-frames.mjs` (pixel-walks the
// rendered frame from center outward to find the transparent "hole"). Re-run
// the script after re-exporting any frame and paste the new values here.
// Or use the interactive tuner at /dev/frames to dial each one visually.
export const BAG_FRAMES: FrameDef[] = [
  { file: 'embellished.svg',       aspect: '1374 / 1831',                inset: { top: '13%',   right: '0%',    bottom: '12%',   left: '0%' },    photoAspect: 0.75 },
  { file: 'horizontal-hung.svg',   aspect: '1178 / 1146',                inset: { top: '28%',   right: '0%',    bottom: '11%',   left: '2%' },    photoAspect: 1.33 },
  { file: 'lines-ivory.svg', aspect: '1786 / 1123',  rotate: 90,   inset: { top: '14%',   right: '19%',   bottom: '13%',   left: '8.5%' },  photoAspect: 1.78 },
  { file: 'lines-ivory.svg', aspect: '1123 / 1786',                inset: { top: '19.5%', right: '15%',   bottom: '12%',   left: '15%' },   photoAspect: 0.5625 },
  { file: 'baroque-portrait.svg',  aspect: '655 / 900',                  inset: { top: '20%',   right: '2%',    bottom: '16%',   left: '5%' },    photoAspect: 0.75 },
  { file: 'baroque-landscape.svg', aspect: '800 / 447',                  inset: { top: '15%',   right: '7%',    bottom: '17%',   left: '7%' },    photoAspect: 1.78 },
  { file: 'cartouche.svg',         aspect: '600 / 506',                  inset: { top: '13%',   right: '11%',   bottom: '13%',   left: '11%' },   photoAspect: 1.33 },
  { file: 'rococo-oval.svg',       aspect: '796 / 991',                  inset: { top: '16%',   right: '18%',   bottom: '15.5%', left: '18%' },   photoAspect: 0.75 },
  { file: 'pearl-swag.svg',        aspect: '1024 / 757',                 inset: { top: '22%',   right: '13.5%', bottom: '21.5%', left: '13.5%' }, photoAspect: 1.78 },
  { file: 'dragonfly-nest-ivory.svg', aspect: '1272 / 1800',             inset: { top: '6%',    right: '10%',   bottom: '8%',    left: '10%' },   photoAspect: 0.75 },
  { file: 'crested-square.svg',    aspect: '840 / 880',                  inset: { top: '17.5%', right: '21.5%', bottom: '21.5%', left: '21.5%' }, photoAspect: 0.75 },
  { file: 'crested-square.svg',    aspect: '840 / 880',                  inset: { top: '17.5%', right: '19.5%', bottom: '21.5%', left: '19%' },   photoAspect: 0.8 },
  { file: 'shell-landscape.svg',   aspect: '927 / 627',                  inset: { top: '1.5%',  right: '10%',   bottom: '0.5%',  left: '9.5%' },  photoAspect: 1.78 },
  { file: 'floral-baroque.svg',    aspect: '417 / 626',                  inset: { top: '22%',   right: '21%',   bottom: '22%',   left: '22%' },   photoAspect: 0.75 },
  { file: 'garden-trellis.svg',    aspect: '581 / 776',                  inset: { top: '16%',   right: '9%',    bottom: '12%',   left: '6%' },    photoAspect: 0.8 },
  { file: 'harvest-wreath.svg',    aspect: '988 / 1272',                 inset: { top: '36%',   right: '18%',   bottom: '20%',   left: '21.5%' }, photoAspect: 0.75 },
  { file: 'florid-portrait.svg',   aspect: '778 / 1188',                 inset: { top: '31.5%', right: '20.5%', bottom: '14.5%', left: '20%' },   photoAspect: 0.75 },
  { file: 'cherub-arch.svg',       aspect: '622 / 792',                  inset: { top: '9.5%',  right: '16%',   bottom: '13%',   left: '14.5%' }, photoAspect: 0.75 },
]

// Per-bag tweaks when the auto-picked frame doesn't fit a particular photo.
// - `frame`: force a specific frame file (overrides the auto-pick).
// - `frameAspect` / `frameRotate` / `frameInset`: inline overrides of the
//   forced frame's default config — useful for "rotated alternate" variants
//   of a frame without adding duplicate entries to BAG_FRAMES.
// - `squishY`: multiply the bag card's natural height (e.g. 0.8 = 20% shorter).
//   Squishes container + photo + frame together.
// - `frameScaleX` / `frameScaleY`: CSS scale on JUST the frame SVG image, not
//   the container or photo (e.g. 0.9 = narrow the frame artwork 10%).
// - `photoZoom`: CSS scale on the photo inside the inset (e.g. 1.4 = 40% zoom in).
// - `photoShiftY`: CSS translateY on the photo (e.g. '-10%' to shift up).
// - `frameShiftY`: CSS translateY on the frame img (e.g. '20%' to shift frame down).
type BagOverride = {
  frame?: string
  frameAspect?: string
  frameRotate?: 0 | 90 | 180 | 270
  frameInset?: { top: string; right: string; bottom: string; left: string }
  squishY?: number
  frameScaleX?: number
  frameScaleY?: number
  photoZoom?: number
  photoShiftY?: string
  frameShiftY?: string
}
const BAG_OVERRIDES: Record<string, BagOverride> = {
  'flower-shop-2026-05-17': { squishY: 0.8 },
  // Force rotated landscape embellished for the 4:3 horizontal hero photo.
  // Replaces the older pearl-swag + zoom/shift hack — embellished's rotated
  // variant is purpose-tuned for 4:3 horizontals.
  'citrus-jute-2026-02-17': {
    frame: 'embellished.svg',
    frameAspect: '1831 / 1374',
    frameRotate: 90,
    frameInset: { top: '13%', right: '0%', bottom: '12%', left: '0%' },
  },
  'classic-reusable-2026-05-17': { frame: 'embellished.svg' },
  'az-2026-05-15': { frame: 'baroque-landscape.svg' },
  'ky-2026-05-15': { squishY: 0.95 },
  // Lines-ivory now defaults to landscape (rotate: 90). Fearless-flyer
  // has a very tall portrait photo so we override back to the unrotated
  // portrait variant.
  'fearless-flyer-2026-05-17': {
    frame: 'lines-ivory.svg',
    frameAspect: '1123 / 1786',
    frameRotate: 0,
    frameInset: { top: '19.5%', right: '15%', bottom: '12%', left: '15%' },
  },
}

function squishAspect(aspect: string, factor: number): string {
  const [w, h] = aspect.split('/').map((s) => parseFloat(s.trim()))
  return `${w} / ${h * factor}`
}

// Frame img CSS. Without rotation it just fills the container. With 90/270 it
// swaps width/height using container query units so the rotated SVG still
// fills the container correctly. Optional translateY layered on top is applied
// LAST in screen space (so "shift down" reads as down regardless of rotation).
// scaleX/scaleY are applied in the SVG's natural coordinate space (before
// rotation), so they squish the artwork along its own axes.
export function frameImgStyle(
  rotate: 0 | 90 | 180 | 270,
  shiftY?: string,
  scaleX?: number,
  scaleY?: number,
): React.CSSProperties {
  const shift = shiftY ? `translateY(${shiftY})` : ''
  const hasScale = (scaleX !== undefined && scaleX !== 1) || (scaleY !== undefined && scaleY !== 1)
  const scale = hasScale ? `scale(${scaleX ?? 1}, ${scaleY ?? 1})` : ''
  if (rotate === 0) {
    const t = [shift, scale].filter(Boolean).join(' ')
    return {
      inset: 0,
      width: '100%',
      height: '100%',
      transform: t || undefined,
    }
  }
  if (rotate === 180) {
    return {
      inset: 0,
      width: '100%',
      height: '100%',
      transform: [shift, 'rotate(180deg)', scale].filter(Boolean).join(' '),
    }
  }
  // 90 or 270 — swap dimensions via container query units so the rotated SVG
  // fills the container post-rotation. Centered via translate.
  return {
    top: '50%',
    left: '50%',
    width: '100cqh',
    height: '100cqw',
    transform: [shift, 'translate(-50%, -50%)', `rotate(${rotate}deg)`, scale]
      .filter(Boolean)
      .join(' '),
    transformOrigin: 'center center',
  }
}

function BagCard({
  bag,
  store,
  encyclopediaEntry,
  assignedFrame,
  stretchTo,
  plaqueBg,
}: {
  bag: PantryBag
  store: Store | undefined
  encyclopediaEntry: EncyclopediaBag | undefined
  assignedFrame: FrameDef | undefined
  stretchTo: number | null
  plaqueBg: string
}) {
  // Hero photo only — Parker's first upload, or the encyclopedia's front
  // photo as fallback. Full gallery lives on the bag detail page.
  const heroSrc =
    bag.photos[0] ?? (encyclopediaEntry ? defaultReferencePhotos(encyclopediaEntry)[0] : undefined)
  const heroUrl = resolvePhotoUrl(heroSrc)
  const usingFallbackPhotos = bag.photos.length === 0 && Boolean(heroSrc)

  // Frames sit flat (no resting tilt) so they look "museum-mounted" rather
  // than askew. The bag-tilt class still provides the hover lift behavior.
  const tilt = 0

  // Frame comes from the parent's round-robin assignment. Fall back to the
  // first frame if no assignment yet (race condition before bags state loads).
  const baseFrame = assignedFrame ?? BAG_FRAMES[0]
  const override = BAG_OVERRIDES[bag.slug] ?? {}

  // Merge inline override fields onto the base frame so overrides can swap
  // rotation / aspect / inset without needing duplicate BAG_FRAMES entries.
  // `stretchTo` (from the assigner) wins over the frame's natural aspect when
  // no compatible frame existed for this photo — the frame visually distorts
  // to fit the photo's actual aspect.
  const baseAspect =
    override.frameAspect ?? (stretchTo !== null ? `${stretchTo}` : baseFrame.aspect)
  const frame: FrameDef = {
    file: baseFrame.file,
    aspect: baseAspect,
    rotate: override.frameRotate ?? baseFrame.rotate ?? 0,
    inset: override.frameInset ?? baseFrame.inset,
  }
  const aspect = override.squishY ? squishAspect(frame.aspect, override.squishY) : frame.aspect
  const photoStyle =
    override.photoZoom || override.photoShiftY
      ? {
          transform: `translateY(${override.photoShiftY ?? '0'}) scale(${override.photoZoom ?? 1})`,
        }
      : undefined

  return (
    <article className="relative">
      <div
        className="bag-tilt relative mx-auto max-w-[380px]"
        style={{ '--tilt': `${tilt}deg` } as React.CSSProperties}
      >
        <Link
          to={`/bags/${bag.slug}`}
          aria-label={`View detail for ${bag.name ?? bag.slug}`}
          className="relative block w-full overflow-hidden"
          style={{ aspectRatio: aspect, containerType: 'size' }}
        >
          {/* Photo sits behind the frame, inset to fit the frame's hollow
              center. Frame is overlaid on top so it can extend over the
              photo's edges decoratively. */}
          <div
            className="absolute overflow-hidden"
            style={frame.inset}
          >
            {heroUrl ? (
              <img
                src={heroUrl}
                alt={bag.name ?? bag.slug}
                className="w-full h-full object-contain p-1"
                style={photoStyle}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--tj-ink)]/30 text-5xl">
                ✦
              </div>
            )}
          </div>
          <img
            src={`${BASE}decor/frames/${frame.file}`}
            alt=""
            aria-hidden
            className="absolute pointer-events-none select-none [filter:drop-shadow(0_2px_1px_rgba(42,31,20,0.22))_drop-shadow(0_5px_6px_rgba(42,31,20,0.28))]"
            style={frameImgStyle(
              frame.rotate ?? 0,
              override.frameShiftY,
              override.frameScaleX,
              override.frameScaleY,
            )}
          />
        </Link>
      </div>

      {/* Gallery plaque — engraved-nameplate aesthetic: cream title cartouche
          at the top sitting on a navy body. Mounted flat below the framed
          photo for a museum-installation feel. */}
      <div className="group mt-4 mx-auto max-w-[360px]">
        <Link
          to={`/bags/${bag.slug}`}
          aria-label={`View detail for ${bag.name ?? bag.slug}`}
          className="block relative border-4 border-double border-[var(--tj-cream)]/40 overflow-hidden shadow-[0_2px_0_rgba(42,31,20,0.20),0_8px_16px_-8px_rgba(42,31,20,0.35)] transition-[transform,border-color] duration-300 ease-out group-hover:border-[var(--tj-cream)]/90 active:scale-[0.98] active:duration-75"
          style={{ backgroundColor: plaqueBg }}
        >
          {/* Title cartouche — cream highlight band */}
          <div className="bg-[var(--tj-cream)] border-b-4 border-double border-[var(--tj-ink)]/30 px-3 py-2">
            <h3
              lang="en"
              className="text-[var(--tj-red)] text-2xl md:text-3xl leading-none text-balance break-words hyphens-auto text-center"
              style={{ fontFamily: 'var(--tj-script)' }}
            >
              {bag.name ?? 'Untitled Bag'}
            </h3>
          </div>

          {/* Body — navy with cream text */}
          <div className="text-[var(--tj-cream)] px-3.5 py-2.5 md:px-4 md:py-3">
            <p className="font-[var(--tj-body)] tracking-[0.22em] text-[0.55rem] uppercase flex items-center justify-center gap-[0.5em] flex-wrap opacity-80">
              <span>{formatShortDate(bag.dateAcquired)}</span>
              <span aria-hidden className="text-[var(--tj-red)]/70 text-[0.7rem] leading-none">·</span>
              <StoreChip storeNumber={bag.storeNumber} store={store} className="text-[var(--tj-ink)]" />
            </p>

            {bag.memory && (
              <>
                <div aria-hidden className="my-2 flex items-center justify-center gap-2 opacity-45">
                  <span className="h-px w-9 bg-[var(--tj-cream)]" />
                  <span className="text-[var(--tj-red)] text-[0.7rem] leading-none">✦</span>
                  <span className="h-px w-9 bg-[var(--tj-cream)]" />
                </div>
                <blockquote className="text-sm md:text-base text-center leading-snug opacity-90">
                  “{bag.memory}”
                  <footer className="mt-1 font-[var(--tj-body)] tracking-[0.25em] text-[0.55rem] uppercase font-semibold opacity-70 not-italic">
                    — Parker
                  </footer>
                </blockquote>
              </>
            )}
          </div>
        </Link>
      </div>

      {usingFallbackPhotos && (
        <p className="mt-3 text-center font-[var(--tj-body)] tracking-[0.18em] text-[0.55rem] uppercase opacity-45">
          Reference photos shown. Parker hasn't added her own yet.
        </p>
      )}
    </article>
  )
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

function resolvePhotoUrl(path: string | undefined): string | null {
  if (!path) return null
  if (path.startsWith('http')) return path
  return `${BASE}${path.replace(/^\//, '')}`
}

// Active masonry column count at the current viewport (md → 2, xl → 3, else 1).
function useColumnCount(): number {
  const getCount = () => {
    if (typeof window === 'undefined') return 3
    if (window.matchMedia('(min-width: 1280px)').matches) return 3
    if (window.matchMedia('(min-width: 768px)').matches) return 2
    return 1
  }
  const [count, setCount] = useState(getCount)
  useEffect(() => {
    const queries = ['(min-width: 1280px)', '(min-width: 768px)'].map((q) =>
      window.matchMedia(q),
    )
    const update = () => setCount(getCount())
    for (const mq of queries) mq.addEventListener('change', update)
    return () => {
      for (const mq of queries) mq.removeEventListener('change', update)
    }
  }, [])
  return count
}

// The photo a card actually shows: Parker's own first upload, else the
// encyclopedia reference photo. Keyed off by the aspect detector + frame picker.
function heroSrcFor(
  bag: PantryBag,
  encyclopediaById: Map<string, EncyclopediaBag>,
): string | undefined {
  if (bag.photos[0]) return bag.photos[0]
  const entry = bag.encyclopediaId ? encyclopediaById.get(bag.encyclopediaId) : undefined
  return entry ? defaultReferencePhotos(entry)[0] : undefined
}

