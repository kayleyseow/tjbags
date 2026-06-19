import { useState } from 'react'
import { Link } from 'react-router'
import styles from './Landing.module.css'
import sealSvg from '../assets/icons/tp_paper_bag_transparent.svg?raw'
import { useTitle } from '../useTitle'

const BASE = import.meta.env.BASE_URL

export default function Landing() {
  useTitle('', undefined, true)
  const [revealed, setRevealed] = useState(false)

  return (
    <main className={`${styles.bag} ${revealed ? styles.browsing : ''}`}>
      <CrumpleOverlay />
      <div className={styles.utensils} aria-hidden>
        <img className={styles.spoon} src={`${BASE}decor/icons/spoon.svg`} alt="" />
        <img className={styles.fork} src={`${BASE}decor/icons/fork.svg`} alt="" />
      </div>
      <div className={styles.border} aria-hidden />

      <div className={styles.firstScreen}>
        <div className={styles.topLabel}>Est. 2026 · A Tote Compendium</div>

        <section className={styles.hero}>
          <h1 className={styles.wordmark} aria-label="Trader Parker's Bag Bazaar">
            <span className={styles.sealComposite}>
              <svg
                className={styles.sealRing}
                viewBox="0 0 200 200"
                aria-hidden
              >
                <defs>
                  <path id="seal-bottom" d="M 1,100 A 99,99 0 0,0 199,100" fill="none" />
                </defs>
                <text className={styles.sealRingText}>
                  <textPath href="#seal-bottom" startOffset="50%" textAnchor="start">
                    BAG BAZAAR
                  </textPath>
                </text>
              </svg>
              <span
                className={styles.sealImage}
                aria-hidden
                dangerouslySetInnerHTML={{ __html: sealSvg }}
              />
            </span>
          </h1>

          <div className={styles.parkerQuestion}>
            <h2 className={styles.parkerQuestionTitle}>Are you Parker?</h2>
            <div className={styles.yesNoRow}>
              <Link
                className={`${styles.cta} ${styles.ctaParker}`}
                to="/admin"
                aria-label="Yes, I'm Parker — go to the Parker page"
              >
                <span aria-hidden className={styles.parkerStar}>★</span>
                <span className={styles.yesText}>Yes, I'm</span>
                <span className={styles.parkerScript} aria-label="Parker">
                  {'Parker'.split('').map((ch, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className="parker-wave"
                      style={{ animationDelay: `${i * 0.05}s` }}
                    >
                      {ch}
                    </span>
                  ))}
                </span>
                <span aria-hidden className={styles.parkerStar}>★</span>
              </Link>
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className={`${styles.cta} ${styles.ctaGhost}`}
              >
                Nope, Just Browsing
              </button>
            </div>
          </div>
        </section>

        <div className={styles.revealedSlot} aria-live="polite">
          {revealed && (
            <>
              <p className={styles.visitorTag}>
                Welcome, fellow TP's bag enthusiast!
              </p>

              <div className={styles.ctaRow}>
                <Link className={`${styles.cta} ${styles.ctaGhost}`} to="/pantry">Peer into Parker's Pantry</Link>
                <Link className={`${styles.cta} ${styles.ctaGhost}`} to="/encyclopedia">Explore the Encyclopedia</Link>
                <Link className={`${styles.cta} ${styles.ctaGhost}`} to="/about">About the Bazaar</Link>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <span>★ Happy Birthday Parker! · Est. 2026 ★</span>
      </div>
    </main>
  )
}

function CrumpleOverlay() {
  return (
    <svg
      className={styles.crumple}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
    >
      <defs>
        <filter id="paperCrumple" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.0125"
            numOctaves="3"
            seed="11"
            stitchTiles="stitch"
            result="noise"
          />
          <feColorMatrix
            type="matrix"
            values="
              0 0 0 0 0.12
              0 0 0 0 0.07
              0 0 0 0 0.03
              0 0 0 0.38 0"
          />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#paperCrumple)" />
    </svg>
  )
}
