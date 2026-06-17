import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import redDotLogo from './assets/icons/orig_red_dot_tp_logo.png'

const BASE = import.meta.env.BASE_URL

/**
 * Site-wide footer used on every interior page (everything except the
 * landing, which has its own bag-tag-style sign-off).
 *
 * Sits inside each page's <main> so the page background extends behind it.
 * Self-contained max-width so it reads consistently regardless of the
 * parent page's content width.
 */
export default function Footer() {
  // Live count of bags in Parker's collection, pulled from the pantry data.
  // Stays null until it loads so the sign-off reads cleanly without it.
  const [bagCount, setBagCount] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    fetch(`${BASE}data/pantry.json`)
      .then((r) => r.json() as Promise<unknown[]>)
      .then((d) => {
        if (active && Array.isArray(d)) setBagCount(d.length)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  return (
    <footer
      role="contentinfo"
      className="relative z-10 mt-10 border-t border-[var(--tj-ink)]/30"
    >
      <div className="max-w-6xl mx-auto px-6 pt-4 pb-2">
        {/* Top row: logo pinned to true page center on desktop via a
            3-column grid so it doesn't drift with the wordmark/nav widths.
            Mobile stacks: logo, wordmark, nav. */}
        <div className="flex flex-col items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
          <Link
            to="/"
            aria-label="Trader Parker's Bag Bazaar"
            className="shrink-0 sm:col-start-2 sm:justify-self-center"
          >
            <img
              src={redDotLogo}
              alt=""
              aria-hidden
              className="h-12 md:h-14 w-auto select-none"
            />
          </Link>
          <a
            href="https://github.com/kayleyseow/traderparkers"
            target="_blank"
            rel="noreferrer"
            className="font-[var(--tj-body)] font-semibold tracking-[0.25em] text-[0.7rem] uppercase opacity-80 hover:opacity-100 underline-offset-4 hover:underline sm:col-start-1 sm:row-start-1 sm:justify-self-start"
          >
            Trader Parker's Bag Bazaar
          </a>
          <nav
            aria-label="Footer navigation"
            className="flex items-center gap-x-4 gap-y-1 md:gap-3 flex-wrap justify-center sm:col-start-3 sm:row-start-1 sm:justify-self-end"
          >
            <FooterLink to="/pantry">Pantry</FooterLink>
            <Separator />
            <FooterLink to="/encyclopedia">Encyclopedia</FooterLink>
            <Separator />
            <FooterLink to="/about">About</FooterLink>
          </nav>
        </div>

        {/* Sign-off */}
        <p className="font-[var(--tj-body)] tracking-[0.2em] text-[0.65rem] uppercase font-semibold text-center mt-3 opacity-75 flex items-center justify-center gap-2">
          <span aria-hidden className="text-[var(--tj-red)]">
            ★
          </span>
          <span>
            Stocked for Parker
            {bagCount !== null && (
              <>
                {' · '}
                <Link
                  to="/pantry"
                  className="underline-offset-4 hover:underline hover:text-[var(--tj-red)] transition-colors"
                >
                  {bagCount} {bagCount === 1 ? 'Bag' : 'Bags'} in da Pantry
                </Link>
              </>
            )}
            {' · Est. 2026'}
          </span>
          <span aria-hidden className="text-[var(--tj-red)]">
            ★
          </span>
        </p>
      </div>
    </footer>
  )
}

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      // Tighter tracking/size on phones so all three nav items fit on one
      // line at ~360px without wrapping; restores at md+.
      className="font-[var(--tj-body)] font-semibold tracking-[0.18em] md:tracking-[0.25em] text-[0.65rem] md:text-[0.7rem] uppercase opacity-70 hover:opacity-100 underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  )
}

function Separator() {
  // Hidden on phones — the gap-x-4 between links is enough separation, and
  // the stars push the row past the viewport width at narrow widths.
  return (
    <span aria-hidden className="hidden md:inline opacity-30 text-[0.7rem]">
      ★
    </span>
  )
}
