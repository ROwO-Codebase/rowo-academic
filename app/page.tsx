import type { Metadata } from "next";
import { Brand } from "../components/Brand";
import { PublicAcademicPreview } from "../components/PublicAcademicPreview";
import { SiteFooter } from "../components/SiteFooter";

export const metadata: Metadata = {
  title: "Plan your Waterloo degree",
  description:
    "Map completed and planned courses to Waterloo program requirements using ROwO Academic.",
};

const signInHref = "/auth/login?return_to=%2Fapp";

export default function Home() {
  return (
    <div className="public-page">
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <nav className="public-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#built-for-planning">What it checks</a>
          </nav>
          <a className="button button-primary button-compact" href={signInHref}>
            Sign in with ROwO
          </a>
        </div>
      </header>

      <main id="main-content">
        <section className="hero-section">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="eyebrow-dot" aria-hidden="true" />
                Built for University of Waterloo students
              </div>
              <h1>See what you’ve finished. Know what comes next.</h1>
              <p className="hero-lede">
                ROwO Academic maps your courses to your program, explains
                requirement gaps, and helps you build a future-term plan you can
                understand.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href={signInHref}>
                  Plan my degree
                  <span aria-hidden="true">→</span>
                </a>
                <a className="button button-secondary" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <ul className="trust-list" aria-label="Product highlights">
                <li><span aria-hidden="true">✓</span> Uses your ROwO account</li>
                <li><span aria-hidden="true">✓</span> Keeps plans private</li>
                <li><span aria-hidden="true">✓</span> Shows uncertain rules</li>
              </ul>
            </div>
            <PublicAcademicPreview />
          </div>
        </section>

        <section className="feature-section" id="built-for-planning">
          <div className="shell">
            <div className="section-heading">
              <span className="eyebrow compact">One clear academic workspace</span>
              <h2>Plan with the rule and the evidence in view.</h2>
              <p>
                Completed work, current courses, and future plans stay distinct,
                so projected progress never looks like finished progress.
              </p>
            </div>
            <div className="feature-grid">
              <article className="feature-card">
                <span className="feature-number" aria-hidden="true">01</span>
                <h3>Track real progress</h3>
                <p>
                  Group courses by term, keep grades optional, and see completed
                  units beside projected units.
                </p>
                <div className="feature-detail">
                  <strong>Completed</strong>
                  <span>In progress</span>
                  <span>Planned</span>
                </div>
              </article>
              <article className="feature-card">
                <span className="feature-number" aria-hidden="true">02</span>
                <h3>Validate requirements</h3>
                <p>
                  See which courses count, where a prerequisite fails, and when
                  a calendar rule needs human review.
                </p>
                <div className="feature-detail">
                  <strong className="text-success">Requirement met</strong>
                  <span className="text-warning">Needs review</span>
                </div>
              </article>
              <article className="feature-card">
                <span className="feature-number" aria-hidden="true">03</span>
                <h3>Plan future terms</h3>
                <p>
                  Put candidate courses into terms and check their prerequisite
                  path before registration season.
                </p>
                <div className="term-mini">
                  <span>Fall</span>
                  <strong>CS 240</strong>
                  <strong>CS 246</strong>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="steps-section" id="how-it-works">
          <div className="shell steps-grid">
            <div className="steps-copy">
              <span className="eyebrow compact">A useful answer in three steps</span>
              <h2>Your program, translated into a plan.</h2>
              <p>
                Start with the calendar that applies to you. ROwO Academic keeps
                that snapshot attached to your profile instead of silently
                changing the rules later.
              </p>
              <a className="text-link" href={signInHref}>
                Start with my ROwO account <span aria-hidden="true">→</span>
              </a>
            </div>
            <ol className="steps-list">
              <li>
                <span>1</span>
                <div>
                  <h3>Choose your program</h3>
                  <p>
                    Search the configured Waterloo calendar by program, major,
                    minor, option, or specialization.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <h3>Add your course history</h3>
                  <p>
                    Record completed and in-progress courses with optional grades,
                    then review what each course satisfies.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <h3>Build the next terms</h3>
                  <p>
                    Add planned courses, move them between terms, and resolve
                    prerequisite or antirequisite warnings.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="cta-section">
          <div className="shell cta-card">
            <div>
              <span className="eyebrow compact light">ROwO Academic</span>
              <h2>Make the next course choice easier to explain.</h2>
              <p>Bring your program and course history into one private plan.</p>
            </div>
            <a className="button button-light" href={signInHref}>
              Sign in and get started
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        <aside className="disclaimer shell" aria-label="Academic planning notice">
          <strong>Independent planning aid.</strong> ROwO Academic is not an
          official University of Waterloo degree audit. Confirm important
          academic decisions with the published calendar and an academic advisor.
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
