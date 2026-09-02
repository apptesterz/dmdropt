/**
 * Page shell and design system.
 *
 * Tokens are taken from the dmdrop Figma file — colours, type scale, spacing
 * and radii are the design's, not invented here.
 *
 * Mobile-first, and not as a courtesy: a creator sets these rules up on their
 * phone, minutes after publishing a reel. Desktop is the secondary case.
 *
 * No client-side framework, no bundler, no external requests — the CSP forbids
 * them all. Icons are inline SVG. Inline style and script carry the nonce.
 */

import { html, raw, type RawHtml } from "./html";

const STYLES = `
  /* Served from this Worker, cached for a year. Never a font CDN — the CSP
     forbids one and self-hosting is the point of the product. */
  @font-face {
    font-family: Inter;
    font-style: normal;
    font-weight: 400 800;
    font-display: swap;
    src: url(/f/inter.woff2) format("woff2");
  }

  :root {
    --accent: #1B6EF3;      --accent-tint: #1B6EF31A;  --accent-fg: #FFFFFF;
    --ok: #0F8B53;          --ok-tint: #0F8B531A;
    --warn: #B26B00;        --warn-tint: #B26B001A;
    --bad: #C0392B;         --bad-tint: #C0392B1A;

    /* Neutrals are true neutrals. The previous set — #212529, #6C757D, #E9ECEF
       — is Bootstrap's default grey ramp, and it carries a blue cast that shows
       up on every surface at once. That cast is the single loudest "built from
       a starter template" signal a UI can send, and no amount of spacing work
       hides it. Measured off manychat.com for comparison: #292929 text on
       #F5F5F5, no hue at all. The brand blue below is untouched. */
    --bg: #F5F5F7;
    --card: #FFFFFF;
    --line: #E5E5E7;
    --fg: #1C1C1E;
    --muted: #6E6E73;

    --r-sm: 12px;   /* buttons, inputs, chips */
    --r-lg: 16px;   /* cards */
    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;

    /* Two steps only. A card resting on the page, and a card being pointed at.
       Cheap shadows read as plastic; these are tuned to the page tint. */
    --lift: 0 1px 2px rgba(16, 24, 40, .04), 0 1px 3px rgba(16, 24, 40, .06);
    --lift-hi: 0 2px 4px rgba(16, 24, 40, .04), 0 10px 20px -6px rgba(16, 24, 40, .10);
    --ring: 0 0 0 3px rgba(27, 110, 243, .32);
  }
  /* Light only, deliberately.
     Auto dark-mode meant the product rendered black for anyone whose OS is set
     that way, which is most people, and a palette drawn for light surfaces does
     not survive being inverted by a media query. Manychat, Stripe and Attio all
     ship light-only for the same reason. If a real dark theme is wanted later it
     needs its own drawn palette, not a token swap. */

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 400 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-text-size-adjust: 100%;
    -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  }
  a { color: var(--accent); }

  /* Every figure on every screen is tabular. Proportional digits change width
     between values, so a number that updates appears to twitch and a column of
     them will not align. This is the single cheapest thing that separates a
     dashboard that feels built from one that feels assembled. */
  .hero .n, .stat .n, .funnel .n, .counter, .ev .when, .pager .page,
  .meter-label, table td, .chip { font-variant-numeric: tabular-nums; }

  /* One focus treatment, everywhere, and it never removes the indicator — the
     transparent outline keeps it visible in forced-colours mode, where box
     shadows are dropped. */
  :focus-visible {
    outline: 2px solid transparent; outline-offset: 2px;
    box-shadow: var(--ring); border-radius: var(--r-sm);
  }

  @media (prefers-reduced-motion: no-preference) {
    .card, .stat, .row-link, .ev, .tile, button, .btn, details.faq, nav.tabs a {
      transition: background-color .12s ease, border-color .12s ease,
                  box-shadow .12s ease, color .12s ease;
    }
  }

  /* --- Type scale ------------------------------------------------------- */
  h1 { font-size: 24px; font-weight: 700; line-height: 1.3; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 17px; font-weight: 600; line-height: 1.4; margin: var(--s5) 0 var(--s3); }
  h3 { font-size: 17px; font-weight: 600; line-height: 1.4; margin: 0 0 var(--s2); }
  .small { font-size: 13px; font-weight: 500; line-height: 1.4; }
  .overline { font-size: 10px; font-weight: 800; line-height: 1.2;
              text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .muted { color: var(--muted); }

  /* --- Shell ------------------------------------------------------------ */
  .wrap { max-width: 720px; margin: 0 auto; padding: var(--s4) var(--s4) 112px; }
  header.bar {
    position: sticky; top: 0; z-index: 10; background: var(--bg);
    border-bottom: 1px solid var(--line); padding: var(--s4);
    display: flex; align-items: center; gap: var(--s3);
  }
  header.bar .brand { display: flex; align-items: center; gap: var(--s2);
                      font-weight: 700; font-size: 20px; letter-spacing: -0.02em; }
  header.bar .mark { width: 32px; height: 32px; border-radius: 9px; background: var(--accent);
                     display: grid; place-items: center; color: #fff; flex: none; }
  header.bar.plain { border-bottom: 0; }
  header.bar .spacer { margin-left: auto; }
  header.bar a { font-size: 13px; font-weight: 500; text-decoration: none; }
  header.bar .back { display: flex; align-items: center; gap: var(--s2);
                     color: var(--fg); font-size: 17px; font-weight: 600; }
  header.bar .screen { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }

  /* --- Bottom navigation ------------------------------------------------ */
  nav.tabs {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
    display: grid; grid-template-columns: repeat(5, 1fr);
    background: var(--bg); border-top: 1px solid var(--line);
    padding: var(--s2) 0 calc(var(--s2) + env(safe-area-inset-bottom));
  }
  nav.tabs a { display: flex; flex-direction: column; align-items: center; gap: 3px;
               text-decoration: none; color: var(--muted); font-size: 11px; font-weight: 600;
               min-height: 48px; justify-content: center;
               white-space: nowrap; overflow: hidden; }
  nav.tabs a.on { color: var(--accent); }

  /* --- Cards ------------------------------------------------------------ */
  .card { background: var(--card); border: 1px solid var(--line);
          border-radius: var(--r-lg); padding: var(--s4); margin-bottom: var(--s3);
          box-shadow: var(--lift); }

  /* --- Stats ------------------------------------------------------------ */
  /* Sizes are the artboard's, measured off it. The design is drawn at 402px and
     is deliberately dense; scaling the padding up with the column is what made
     an earlier pass feel inflated and generic. Wider column, same rhythm. */
  .hero { background: var(--card); border: 1px solid var(--line);
          border-radius: var(--r-lg); padding: var(--s4); margin-bottom: var(--s3);
          box-shadow: var(--lift); }

  /* --- The rate bar ------------------------------------------------------ */
  /* The one place this design raises its voice. The fill is the click-through
     rate, so the number above it has a physical size rather than being a figure
     you have to interpret — which is the whole argument this product makes:
     messages sent tell you nothing, taps tell you everything.
     Width arrives as a nonce'd rule, since the CSP forbids style attributes. */
  .hero .rate { height: 6px; border-radius: 999px; background: var(--line);
                margin-top: var(--s4); overflow: hidden; }
  .hero .rate i { display: block; height: 100%; border-radius: 999px;
                  background: var(--accent); transform-origin: left center; }
  .hero .ends { display: flex; justify-content: space-between;
                margin-top: var(--s2); font-size: 12px; color: var(--muted);
                font-variant-numeric: tabular-nums; }
  .hero .ends b { color: var(--fg); font-weight: 600; }
  @media (prefers-reduced-motion: no-preference) {
    .hero .rate i { animation: rate-in .55s cubic-bezier(.2, .8, .2, 1) both; }
    @keyframes rate-in { from { transform: scaleX(0); } }
  }
  .hero .top { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
  .hero .k { font-size: 13px; font-weight: 500; color: var(--muted); }
  .hero .n { font-size: 34px; font-weight: 800; line-height: 1.15;
             letter-spacing: -0.03em; margin-top: var(--s1); }
  .hero .sub { font-size: 13px; color: var(--muted); margin-left: var(--s2); font-weight: 500; }

  .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s3); }
  @media (min-width: 560px) { .stats { grid-template-columns: repeat(4, 1fr); } }
  /* Higher specificity than the rule above, so it holds at every width. */
  .stats.two { grid-template-columns: repeat(2, 1fr); }
  .stats .wide { grid-column: 1 / -1; }
  /* A handle is text, not a figure — the numeric size reads as shouting. */
  .stat.wide .n { font-size: 17px; overflow-wrap: anywhere; }
  .stat { background: var(--card); border: 1px solid var(--line);
          border-radius: var(--r-lg); padding: var(--s3) var(--s4);
          box-shadow: var(--lift); }
  .stat .k { font-size: 13px; font-weight: 500; color: var(--muted); }
  .stat .n { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin-top: 2px; }

  /* --- Rows ------------------------------------------------------------- */
  .rows { background: var(--card); border: 1px solid var(--line);
          border-radius: var(--r-lg); overflow: hidden; margin-bottom: var(--s3);
          box-shadow: var(--lift); }
  .row-link { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4);
              text-decoration: none; color: inherit; border-bottom: 1px solid var(--line);
              min-height: 48px; }
  .row-link:last-child { border-bottom: 0; }
  .row-link .grow { flex: 1; min-width: 0; }
  .row-link .title { font-weight: 600; font-size: 15px; }
  .row-link .meta { font-size: 13px; color: var(--muted); margin-top: var(--s1);
                    display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .row-link .chev { color: var(--muted); flex: none; display: flex; }

  .list-item { display: flex; justify-content: space-between; align-items: center;
               gap: var(--s3); padding: var(--s3) 0; border-bottom: 1px solid var(--line); }
  .list-item:last-child { border-bottom: 0; }
  .list-item a { text-decoration: none; font-weight: 600; }

  /* --- Chips ------------------------------------------------------------ */
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px;
          border-radius: 999px; background: var(--line); font-size: 11px;
          font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
          color: var(--muted); }
  .chip.ok { background: var(--ok-tint); color: var(--ok); }
  .chip.warn { background: var(--warn-tint); color: var(--warn); }
  .chip.bad { background: var(--bad-tint); color: var(--bad); }
  .chip.accent { background: var(--accent-tint); color: var(--accent); }

  /* --- Notices ---------------------------------------------------------- */
  .notice { border-radius: var(--r-sm); padding: var(--s3) var(--s4); margin-bottom: var(--s3);
            font-size: 13px; font-weight: 500; border: 1px solid var(--line); background: var(--card); }
  .notice.bad { border-color: var(--bad); background: var(--bad-tint); color: var(--bad); }
  .notice.ok { border-color: var(--ok); background: var(--ok-tint); color: var(--ok); }
  .notice.warn { border-color: var(--warn); background: var(--warn-tint); color: var(--warn); }
  .notice a { color: inherit; font-weight: 700; }

  /* --- Forms ------------------------------------------------------------ */
  label { display: block; font-size: 13px; font-weight: 600; margin: var(--s4) 0 var(--s2); }
  .hint { display: block; font-size: 13px; color: var(--muted); font-weight: 400; margin-top: var(--s1); }
  input[type=text], input[type=password], input[type=url], input[type=number], textarea, select {
    width: 100%; padding: 13px var(--s3); font: inherit; color: var(--fg);
    background: var(--card); border: 1px solid var(--line); border-radius: var(--r-sm);
    min-height: 52px; font-size: 16px;
  }
  textarea { min-height: 110px; resize: vertical; line-height: 1.5; }
  input:focus, textarea:focus, select:focus {
    outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent);
  }
  .row { display: flex; align-items: flex-start; gap: var(--s3); margin: var(--s3) 0; }
  .row input[type=checkbox], .row input[type=radio] { width: 22px; height: 22px; margin: 1px 0 0; flex: none; }
  .row label { margin: 0; }
  .counter { font-size: 11px; color: var(--muted); text-align: right; margin-top: var(--s1); }
  .kwpreview { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s2); }

  /* --- Buttons ---------------------------------------------------------- */
  button, .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--s2);
    /* 48px minimum: thumbs, not mice. */
    min-height: 48px; padding: 11px var(--s5); font: inherit; font-weight: 600;
    border: 1px solid transparent; border-radius: var(--r-sm); cursor: pointer;
    background: var(--accent); color: var(--accent-fg); text-decoration: none;
  }
  .btn.secondary, button.secondary { background: transparent; color: var(--fg); border-color: var(--line); }
  .btn.danger, button.danger { background: transparent; color: var(--bad); border-color: var(--bad); }
  .btn.block, button.block { width: 100%; }

  /* --- Copy fields ------------------------------------------------------ */
  .copy { display: flex; gap: var(--s2); align-items: stretch; margin: var(--s2) 0; }
  .copy input { flex: 1; min-width: 0; }
  .copy button { min-width: 48px; padding: 0 var(--s3); background: var(--bg);
                 border-color: var(--line); color: var(--muted); }
  .copy button.done { color: var(--ok); border-color: var(--ok); }

  /* --- Stepper ---------------------------------------------------------- */
  .stepper { display: flex; align-items: center; gap: var(--s2); margin-bottom: var(--s5); }
  .stepper .st { display: flex; align-items: center; gap: var(--s2);
                 font-size: 13px; font-weight: 600; color: var(--muted); }
  .stepper .dot { width: 24px; height: 24px; border-radius: 999px; flex: none;
                  display: grid; place-items: center; font-size: 11px; font-weight: 700;
                  background: var(--line); color: var(--muted); }
  .stepper .st.on .dot { background: var(--accent); color: #fff; }
  .stepper .st.on { color: var(--accent); }
  .stepper .st.done .dot { background: var(--ok); color: #fff; }
  .stepper .st.done { color: var(--ok); }
  .stepper .bar { flex: 1; height: 2px; background: var(--line); border-radius: 2px; }

  /* --- Media grid ------------------------------------------------------- */
  .grid-media { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); }
  @media (min-width: 560px) { .grid-media { grid-template-columns: repeat(4, 1fr); } }
  .grid-media label { margin: 0; cursor: pointer; position: relative; display: block; }
  .grid-media img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--r-sm);
                    display: block; border: 3px solid transparent; }
  .grid-media input { position: absolute; opacity: 0; pointer-events: none; }
  .grid-media input:checked + img { border-color: var(--accent); }

  /* --- Tables ----------------------------------------------------------- */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { text-align: left; padding: 10px var(--s2); border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-size: 10px; font-weight: 800;
       text-transform: uppercase; letter-spacing: 0.08em; }
  tr:last-child td { border-bottom: 0; }
  .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* --- Auth screens ----------------------------------------------------- */
  .auth { max-width: 380px; margin: 0 auto; padding-top: var(--s6); }
  .auth .lede { text-align: center; margin-bottom: var(--s6); }
  .auth .lede h1 { font-size: 26px; margin-bottom: var(--s2); }
  .auth .lede p { color: var(--muted); font-size: 15px; margin: 0; }
  .auth label { margin-top: var(--s5); }
  .auth .actions { margin-top: var(--s5); }
  .auth .foot { text-align: center; color: var(--muted); font-size: 13px; margin-top: var(--s6); }

  /* --- Misc ------------------------------------------------------------- */
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .steps-list { padding-left: 18px; line-height: 1.9; }
  .empty { text-align: center; padding: var(--s6) var(--s4); }
  .empty .icon { width: 48px; height: 48px; margin: 0 auto var(--s3); border-radius: 999px;
                 background: var(--accent-tint); display: grid; place-items: center; color: var(--accent); }
  .mt-0 { margin-top: 0; } .mt-8 { margin-top: 8px; } .mt-10 { margin-top: 10px; }
  .mt-12 { margin-top: 12px; } .mt-14 { margin-top: 14px; }
  .mt-18 { margin-top: 18px; } .mt-24 { margin-top: 24px; }

  /* --- Card section label ------------------------------------------------ */
  /* The design labels each card with an overline inside it rather than a
     heading above it, so a screen reads as a stack of titled cards. */
  .card > .overline { display: block; margin-bottom: var(--s3); }

  /* --- Tile rows (icon · title · trailing) ------------------------------- */
  .tile { display: flex; align-items: center; gap: var(--s3);
          padding: var(--s3) 0; text-decoration: none; color: inherit; min-height: 48px; }
  .tile + .tile { border-top: 1px solid var(--line); }
  .tile .ic { width: 40px; height: 40px; border-radius: 10px; flex: none;
              background: var(--accent-tint); color: var(--accent);
              display: grid; place-items: center; }
  .tile .grow { flex: 1; min-width: 0; }
  .tile .title { font-weight: 600; font-size: 15px; }
  .tile .sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .tile .sub.link { color: var(--accent); }
  .tile .go { color: var(--muted); flex: none; display: flex; }

  /* --- Accordion --------------------------------------------------------- */
  /* <details>, not a scripted accordion: it opens with JavaScript disabled,
     it is focusable and announced correctly, and Ctrl-F finds text inside a
     closed one in Chrome. Nothing hand-written matches that. */
  details.faq { background: var(--card); border: 1px solid var(--line);
                border-radius: var(--r-lg); margin-bottom: var(--s2);
                box-shadow: var(--lift); }
  details.faq > summary { list-style: none; cursor: pointer; display: flex;
                          align-items: center; gap: var(--s3); padding: var(--s4);
                          font-weight: 600; font-size: 15px; min-height: 48px; }
  details.faq > summary::-webkit-details-marker { display: none; }
  details.faq > summary .grow { flex: 1; }
  details.faq > summary svg { color: var(--muted); flex: none; transition: transform .15s; }
  details.faq[open] > summary svg { transform: rotate(180deg); }
  details.faq .body { padding: 0 var(--s4) var(--s4); font-size: 14px; }
  details.faq .body > :first-child { margin-top: 0; }
  details.faq .body > :last-child { margin-bottom: 0; }
  @media (prefers-reduced-motion: reduce) { details.faq > summary svg { transition: none; } }

  /* --- Danger zone ------------------------------------------------------- */
  .card.danger { background: var(--bad-tint); border-color: var(--bad); }
  .card.danger .overline { color: var(--bad); }
  button.danger-solid, .btn.danger-solid { background: var(--bad); color: #fff; border-color: var(--bad); }

  /* --- Filter bar -------------------------------------------------------- */
  .filters { display: flex; gap: var(--s2); margin-bottom: var(--s3); align-items: flex-end; }
  .filters label { margin: 0; flex: 1; min-width: 0; }
  .filters select { margin-top: var(--s2); }

  /* --- Event rows -------------------------------------------------------- */
  .ev { display: flex; align-items: center; gap: var(--s3); background: var(--card);
        border: 1px solid var(--line); border-radius: var(--r-lg);
        padding: var(--s3) var(--s4); margin-bottom: var(--s2);
        box-shadow: var(--lift); }
  .ev .grow { flex: 1; min-width: 0; }
  .ev .who { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
  .ev .rule { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .ev .right { display: flex; align-items: center; gap: var(--s3); flex: none; }
  .ev .when { font-size: 13px; color: var(--muted); white-space: nowrap; }
  @media (max-width: 560px) {
    .ev { flex-wrap: wrap; }
    .ev .right { width: 100%; justify-content: flex-start; }
  }

  /* --- Pager ------------------------------------------------------------- */
  .pager { display: flex; align-items: center; justify-content: space-between;
           gap: var(--s3); margin: var(--s4) 0; }
  .pager .page { font-size: 14px; font-weight: 600; color: var(--muted); }
  .pager .btn { min-width: 48px; padding: 0 var(--s3); }
  .pager .off { visibility: hidden; }

  /* --- Funnel ------------------------------------------------------------ */
  .funnel { display: flex; align-items: stretch; gap: var(--s2); }
  .funnel .step { flex: 1; min-width: 0; background: var(--card); border: 1px solid var(--line);
                  border-radius: var(--r-sm); padding: var(--s3) var(--s2); text-align: center; }
  .funnel .step.on { border-color: var(--accent); }
  .funnel .step .k { font-size: 10px; font-weight: 800; letter-spacing: .06em;
                     text-transform: uppercase; color: var(--muted); }
  .funnel .step .n { font-size: 18px; font-weight: 700; margin-top: var(--s1); }
  .funnel .step.on .n { color: var(--accent); }
  .funnel .arr { display: grid; place-items: center; color: var(--muted); flex: none; }

  .ver { text-align: center; font-size: 12px; color: var(--muted); margin-top: var(--s6); }

  /* --- Form actions ------------------------------------------------------ */
  /* Stacked on a phone where the thumb wants a full-width target, one row at
     natural width on a desktop. The cancel route is a link, not a button: it
     discards, so it should not look equal to the thing that saves. */
  .form-actions { display: flex; flex-direction: column; gap: var(--s2);
                  margin-top: var(--s5); }
  .form-actions .out { display: inline-flex; align-items: center; justify-content: center;
                       min-height: 44px; font-size: 14px; font-weight: 600;
                       color: var(--muted); text-decoration: none; }
  @media (min-width: 768px) {
    .form-actions { flex-direction: row-reverse; justify-content: flex-start;
                    align-items: center; gap: var(--s4); }
    .form-actions button { min-width: 200px; }
  }

  /* --- Section header ---------------------------------------------------- */
  /* The action belongs beside the heading it acts on. A full-width primary
     button is right exactly once — in an empty state, where it is the only
     thing to do — and everywhere else it outshouts the content it sits under. */
  .sec-head { display: flex; align-items: center; justify-content: space-between;
              gap: var(--s3); margin: var(--s5) 0 var(--s3); }
  .sec-head h2 { margin: 0; }
  .sec-actions { display: flex; gap: var(--s2); flex: none; }
  .btn.sm, button.sm { min-height: 36px; padding: 0 var(--s4); font-size: 14px;
                       border-radius: 10px; }

  /* --- Brand placement --------------------------------------------------- */
  /* The brand sits in the bar on a phone and at the top of the rail on a
     desktop, so it never appears twice and the bar is free to name the screen. */
  /* Selectors are qualified to out-specify "nav.tabs a" and "header.bar .brand";
     a bare class loses to those and the brand renders twice. */
  nav.tabs .rail-brand { display: none; }
  header.bar .only-wide { display: none; }
  @media (min-width: 1024px) {
    header.bar .only-wide { display: inline-flex; }
    header.bar .only-narrow { display: none; }
    nav.tabs .rail-brand { display: flex; flex-direction: row; align-items: center;
                  gap: var(--s2); justify-content: flex-start;
                  font-weight: 700; font-size: 19px; letter-spacing: -0.02em;
                  padding: var(--s3); margin-bottom: var(--s2); color: var(--fg);
                  text-decoration: none; min-height: 48px; }
    nav.tabs .rail-brand:hover { background: transparent; }
    nav.tabs .rail-brand .mark { width: 32px; height: 32px; border-radius: 9px; flex: none;
                        background: var(--accent); color: #fff;
                        display: grid; place-items: center; }
    nav.tabs .rail-brand svg { width: 18px; height: 18px; }
  }

  /* --- Wizard ------------------------------------------------------------ */
  .lede-c { text-align: center; margin-bottom: var(--s5); }
  .lede-c .logo { display: inline-flex; align-items: center; gap: var(--s2);
                  font-weight: 700; font-size: 22px; letter-spacing: -0.02em;
                  margin-bottom: var(--s5); }
  .lede-c .logo .mark { width: 36px; height: 36px; border-radius: 10px; background: var(--accent);
                        display: grid; place-items: center; color: #fff; }
  .lede-c h1 { font-size: 26px; margin-bottom: var(--s2); }
  .lede-c p { color: var(--muted); margin: 0; }
  .lede-l { margin-bottom: var(--s5); }
  .lede-l h1 { margin-bottom: var(--s2); }
  .lede-l p { color: var(--muted); margin: 0; }

  /* Numbered card heading, as on the Configure step. */
  .stepnum { display: flex; align-items: center; gap: var(--s3); margin-bottom: var(--s3); }
  .stepnum .n { width: 24px; height: 24px; border-radius: 7px; flex: none;
                background: var(--accent-tint); color: var(--accent);
                display: grid; place-items: center; font-size: 12px; font-weight: 700; }
  .stepnum h3 { margin: 0; }

  /* The breadcrumb telling you where in Meta's console the field lives. It
     belongs under the value, where the eye lands after reading it. */
  .under { font-size: 12px; color: var(--muted); margin: calc(var(--s1) * -1) 0 var(--s4); }

  .checks { list-style: none; padding: 0; margin: var(--s4) 0 0; }
  .checks li { display: flex; gap: var(--s3); padding: var(--s2) 0; }
  .checks .tick { width: 22px; height: 22px; border-radius: 999px; flex: none;
                  background: var(--ok-tint); color: var(--ok);
                  display: grid; place-items: center; }
  .checks .title { font-weight: 600; font-size: 15px; }
  .checks .sub { font-size: 13px; color: var(--muted); margin-top: 2px; }

  /* Instagram's own gradient, on the button that leaves for Instagram. */
  .btn.ig { background: linear-gradient(95deg, #C9379D 0%, #E8483F 55%, #F1A32F 100%);
            color: #fff; border-color: transparent; }

  .conn { display: flex; align-items: center; justify-content: center; gap: var(--s4); }
  .conn .node { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; }
  .conn .node.us { background: var(--accent-tint); color: var(--accent); }
  .conn .node.them { background: linear-gradient(135deg, #C9379D, #E8483F 60%, #F1A32F); color: #fff; }
  .conn .swap { color: var(--muted); }
  .conn-label { text-align: center; margin: var(--s3) 0 0; }

  /* --- Password field ---------------------------------------------------- */
  .pw { position: relative; }
  .pw input { padding-right: 52px; }
  .pw .peek { position: absolute; right: 4px; top: 0; bottom: 0; min-height: 0;
              background: none; border: 0; color: var(--muted); padding: 0 var(--s3); }
  .meter { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s1);
           margin-top: var(--s2); }
  .meter i { height: 4px; border-radius: 2px; background: var(--line); }
  .meter i.on { background: var(--accent); }
  .meter-label { font-size: 13px; font-weight: 600; color: var(--accent); margin-top: var(--s2); }

  /* --- Toggle rows ------------------------------------------------------- */
  /* A styled checkbox, not a div pretending to be one: it is focusable, it is
     announced as a checkbox, it submits with the form, and it works with
     scripting off. Only the paint is ours. */
  .sw { display: flex; align-items: center; gap: var(--s4); padding: var(--s3) 0; }
  .sw + .sw { border-top: 1px solid var(--line); }
  .sw .grow { flex: 1; min-width: 0; }
  .sw .title { font-weight: 600; font-size: 15px; }
  .sw .sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .sw label { margin: 0; font-weight: inherit; font-size: inherit; }
  .sw input[type=checkbox] {
    appearance: none; -webkit-appearance: none; position: relative; flex: none;
    width: 48px; height: 28px; margin: 0; border: 0; border-radius: 999px;
    background: var(--line); cursor: pointer; transition: background .15s;
  }
  .sw input[type=checkbox]::after {
    content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px;
    border-radius: 999px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.28);
    transition: transform .15s;
  }
  .sw input[type=checkbox]:checked { background: var(--accent); }
  .sw input[type=checkbox]:checked::after { transform: translateX(20px); }
  .sw input[type=checkbox]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .sw input[type=checkbox], .sw input[type=checkbox]::after { transition: none; }
  }

  /* --- Chip selector ----------------------------------------------------- */
  .chips { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s2); }
  .chips label { margin: 0; }
  .chips input { position: absolute; opacity: 0; width: 0; height: 0; }
  .chips span { display: inline-flex; align-items: center; min-height: 40px;
                padding: 0 var(--s4); border-radius: 999px; cursor: pointer;
                border: 1px solid var(--line); background: var(--card);
                font-size: 14px; font-weight: 600; color: var(--muted); }
  .chips input:checked + span { background: var(--accent-tint);
                                border-color: var(--accent); color: var(--accent); }
  .chips input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Account picker. Ordinary links, so choosing one reloads the editor with the
     post grid for that account — no scripting involved. */
  .chips a.acct { display: inline-flex; align-items: center; min-height: 40px;
                  padding: 0 var(--s4); border-radius: 999px; text-decoration: none;
                  border: 1px solid var(--line); background: var(--card);
                  font-size: 14px; font-weight: 600; color: var(--muted); }
  .chips a.acct.on { background: var(--accent-tint); border-color: var(--accent);
                     color: var(--accent); }

  /* Keyword chips. The text field stays the source of truth so the form works
     without scripting; these are a view of it that can also delete. */
  .kwpreview button { min-height: 32px; padding: 0 var(--s2) 0 var(--s3); gap: var(--s1);
                      border-radius: 999px; background: var(--accent-tint);
                      color: var(--accent); border: 0; font-size: 12px; font-weight: 700;
                      letter-spacing: 0.03em; text-transform: uppercase; }

  /* --- Pointer ----------------------------------------------------------- */
  /* Only where a real cursor exists. On a touch screen :hover sticks after a
     tap and leaves rows looking permanently selected. */
  @media (hover: hover) {
    .row-link:hover { background: var(--accent-tint); }
    .ev:hover, details.faq:hover { box-shadow: var(--lift-hi); border-color: var(--muted); }
    button:hover, .btn:hover { filter: brightness(0.94); }
    button.secondary:hover, .btn.secondary:hover { border-color: var(--muted); filter: none; }
    nav.tabs a:hover { color: var(--fg); }
    nav.tabs a.on:hover { color: var(--accent); }
    a.tile:hover .title { color: var(--accent); }
    details.faq > summary:hover { color: var(--accent); }
  }

  /* --- Desktop ----------------------------------------------------------- */
  /* The design is drawn for a phone, but this ships as a website. Nothing about
     the design changes here — same colours, same type scale, same components.
     What changes is placement: the thumb-reach bottom bar becomes a second
     sticky bar under the brand, and the 48px touch targets relax to pointer
     sizes. Below 768px the phone layout is used verbatim. */
  /* Anything with a pointer, at any width above a phone. */
  @media (min-width: 768px) {
    /* The 112px reserve exists only for the fixed phone bar. */
    .wrap { padding: var(--s5) var(--s4) var(--s6); }

    /* 16px inputs exist to stop iOS zooming on focus. A mouse needs neither
       that nor a 48px target. */
    input[type=text], input[type=password], input[type=url], input[type=number],
    textarea, select { font-size: 15px; min-height: 44px; padding: 10px var(--s3); }
    button, .btn { min-height: 44px; padding: 10px var(--s5); }
    .copy button { min-width: 44px; }

    /* A submit button stretched across a 900px card is a mobile pattern left on
       a desktop. Inside a card's form it takes its natural width; standalone
       calls to action — an empty state, the wizard — keep the full bar. */
    .card form button.block, .card form .btn.block { width: auto; min-width: 200px; }

    .auth { padding-top: 64px; }
  }

  /* Tablet: the phone's bottom bar becomes a second row under the brand. Too
     narrow for a sidebar, too wide for thumb-reach navigation. */
  @media (min-width: 768px) and (max-width: 1023.98px) {
    header.bar, nav.tabs { padding-inline: max(var(--s4), calc((100% - 720px) / 2)); }
    header.bar { height: 64px; padding-block: 0; }
    nav.tabs {
      position: sticky; top: 64px; bottom: auto; z-index: 9;
      display: flex; gap: var(--s5);
      border-top: 0; border-bottom: 1px solid var(--line);
      padding-block: 0;
    }
    nav.tabs a {
      flex-direction: row; gap: var(--s2); font-size: 14px;
      min-height: 46px; border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    nav.tabs a.on { border-bottom-color: var(--accent); }
    nav.tabs svg { width: 18px; height: 18px; }
  }

  /* --- Desktop sidebar --------------------------------------------------- */
  /* The same four destinations, moved to a left rail. Explicit grid areas
     rather than auto-placement: the nav sits between the header and the content
     in the source (so it reads in order, and so the phone's fixed bar needs no
     reordering), and only the grid moves it beside them. */
  @media (min-width: 1024px) {
    body.has-rail {
      display: grid; min-height: 100vh;
      grid-template-columns: 248px minmax(0, 1fr);
      grid-template-rows: auto 1fr;
    }
    body.has-rail nav.tabs   { grid-area: 1 / 1 / 3 / 2; }
    body.has-rail header.bar { grid-area: 1 / 2 / 2 / 3; }
    body.has-rail main.wrap  { grid-area: 2 / 2 / 3 / 3; }

    nav.tabs {
      position: sticky; top: 0; left: auto; right: auto; bottom: auto;
      height: 100vh; align-content: start;
      display: flex; flex-direction: column; gap: 2px;
      background: var(--card);
      border-top: 0; border-right: 1px solid var(--line);
      padding: var(--s3) var(--s3) var(--s4);
    }
    nav.tabs a {
      flex-direction: row; justify-content: flex-start; gap: var(--s3);
      min-height: 44px; padding: 0 var(--s3); border-radius: var(--r-sm);
      font-size: 14px; font-weight: 600;
    }
    nav.tabs a.on { background: var(--accent-tint); }
    nav.tabs svg { width: 20px; height: 20px; }

    header.bar { position: sticky; top: 0; height: 68px; padding-block: 0; }

    /* The rail anchors the left edge, so the content no longer needs to be
       centred in the whole viewport to avoid looking adrift. */
    /* Left-aligned against the rail, not centred in what the rail leaves over.
       Centring opens a gap between the navigation and the content it belongs
       to, and the eye reads that gap as a missing column.
       Scoped to has-rail: the wizard and sign-in have no rail, so they stay
       centred in the viewport the way a standalone page should. */
    body.has-rail .wrap { max-width: 880px; margin: 0;
                          padding: var(--s5) var(--s6) var(--s6); }
  }
`;

/** Inline SVG only — the CSP blocks every icon font and external asset. */
const ICONS: Record<string, string> = {
  bolt: '<path d="M13 2 4.5 12.5h5.5L11 22l8.5-10.5H14L13 2Z" fill="currentColor"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  help: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.25-1.2.9-1.2 1.6v.5M12 17h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  cog: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  chevron: '<path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2"/>',
  back: '<path d="M19 12H5m0 0 6-6m-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  down: '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m3.5 7 8.5 6 8.5-6" fill="none" stroke="currentColor" stroke-width="2"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5v-15Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M4 19.5A1.5 1.5 0 0 1 5.5 21H19" fill="none" stroke="currentColor" stroke-width="2"/>',
  out: '<path d="M8 16 16 8m0 0H9m7 0v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  insta: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>',
  key: '<circle cx="8" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12h9m-3 0v3m-2-3v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
  plug: '<path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0V9ZM12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  swap: '<path d="M4 9h13m0 0-3-3m3 3-3 3M20 15H7m0 0 3-3m-3 3 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};

/**
 * Favicon as a data URI.
 *
 * A browser tab wants one and an external file would need a route, a cache
 * header and an asset pipeline. The CSP already allows `data:` for images.
 */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E" +
  "%3Crect width='24' height='24' rx='6' fill='%231B6EF3'/%3E" +
  "%3Cpath d='M13 4 6.5 13.5H11L10.5 20 17.5 10.5H13V4Z' fill='white'/%3E%3C/svg%3E";

export function icon(name: string, size = 24): RawHtml {
  return raw(
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name] ?? ""}</svg>`,
  );
}

export type Tab = "home" | "logs" | "contacts" | "help" | "settings";

export interface LayoutOptions {
  title: string;
  nonce: string;
  session?: boolean;
  back?: { href: string; label: string };
  /**
   * Screen name shown in the bar in place of the brand.
   *
   * The design puts the brand only on the dashboard; every other screen names
   * itself there, so the title never has to be repeated in the content.
   */
  heading?: string;
  /** Highlights a bottom tab. Omit to hide the bar (setup and sign-in). */
  tab?: Tab;
  /**
   * Optional inline script, carrying the page nonce.
   *
   * Every screen must remain fully usable without this running — progressive
   * enhancement only, never a dependency.
   */
  script?: string;
  /**
   * Extra CSS for this page, carrying the nonce.
   *
   * Exists because the CSP forbids style attributes outright, so a value the
   * server computes — a bar width, a column count — cannot ride along on the
   * element. Callers must emit only values they derived themselves; nothing
   * from a request ever reaches this.
   */
  style?: string;
}

function tabs(active: Tab): string {
  const items: Array<[Tab, string, string, string]> = [
    ["home", "/", "home", "Home"],
    ["logs", "/logs", "list", "Activity"],
    ["contacts", "/contacts", "mail", "Contacts"],
    ["help", "/help", "help", "Help"],
    ["settings", "/settings", "cog", "Settings"],
  ];
  // The brand lives here so that on a desktop it sits at the top of the rail,
  // the way it does in the bar on a phone. CSS shows one or the other, never
  // both.
  const brand = `<a class="rail-brand" href="/"><span class="mark">${icon("bolt", 18).value}</span>dmdrop</a>`;

  return `<nav class="tabs">${brand}${items
    .map(
      ([key, href, ic, label]) =>
        `<a href="${href}"${key === active ? ' class="on"' : ""}>${icon(ic, 22).value}<span>${label}</span></a>`,
    )
    .join("")}</nav>`;
}

export function layout(options: LayoutOptions, body: RawHtml): string {
  const brand = `<span class="brand"><span class="mark">${icon("bolt", 18).value}</span>dmdrop</span>`;

  // On a tabbed screen with a heading, both are emitted and CSS picks: the brand
  // on a phone, where there is no rail to hold it, and the screen name on a
  // desktop, where the rail already shows the brand.
  const header = options.back
    ? `<a class="back" href="${options.back.href}">${icon("back", 22).value}<span>${escapeTitle(options.back.label)}</span></a>`
    : options.heading
      ? `<span class="brand only-narrow"><span class="mark">${icon("bolt", 18).value}</span>dmdrop</span>` +
        `<span class="screen only-wide">${escapeTitle(options.heading)}</span>`
      : brand;

  // Shown on every signed-in page. On a phone the tab bar owns the bottom of
  // the screen, so this is the only place sign-out can live.
  const signOut = options.session ? '<a href="/logout">Sign out</a>' : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex, nofollow">
<title>${escapeTitle(options.title)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${FAVICON}">
<meta name="theme-color" content="#1B6EF3">
<style nonce="${options.nonce}">${STYLES}${options.style ?? ""}</style>
</head>
<body${options.tab ? ' class="has-rail"' : ""}>
<header class="bar${options.tab || options.back ? "" : " plain"}">${header}<span class="spacer"></span>${signOut}</header>
${options.tab ? tabs(options.tab) : ""}
<main class="wrap">${body.value}</main>
${options.script ? `<script nonce="${options.nonce}">${options.script}</script>` : ""}
</body>
</html>`;
}

function escapeTitle(value: string): string {
  // String(): every caller feeds this a field off a `first<Row>()` result, and
  // that generic is an unchecked cast, not a validation. A column dropped from
  // a SELECT would otherwise crash the whole page render rather than render an
  // empty title.
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Hidden CSRF field. Every state-changing form must include it. */
export function csrfField(token: string): RawHtml {
  return html`<input type="hidden" name="_csrf" value="${token}">`;
}

/**
 * A labelled switch.
 *
 * The visible control is a real checkbox with a `name`, so the value posts with
 * the form and reads correctly to a screen reader. Only the styling is ours.
 */
export function toggle(options: {
  id: string;
  name: string;
  title: string | RawHtml;
  sub?: string | RawHtml;
  checked?: boolean;
}): RawHtml {
  return html`<div class="sw">
    <div class="grow">
      <label class="title" for="${options.id}">${options.title}</label>
      ${options.sub ? html`<div class="sub">${options.sub}</div>` : raw("")}
    </div>
    <input type="checkbox" id="${options.id}" name="${options.name}"
           ${options.checked ? raw("checked") : raw("")}>
  </div>`;
}

export function notice(kind: "ok" | "bad" | "warn" | "", message: string): RawHtml {
  if (!message) return raw("");
  return html`<div class="notice ${kind}">${message}</div>`;
}

/**
 * A read-only value with a copy button.
 *
 * These carry the URLs a creator pastes into Meta's console, on a phone, where
 * selecting long text by hand is genuinely painful. The button is progressive
 * enhancement — without scripting the field is still selectable.
 */
export function copyField(value: string, id: string): RawHtml {
  return html`<div class="copy">
    <input type="text" class="mono" id="${id}" readonly value="${value}">
    <button type="button" class="secondary" data-copy="${id}" aria-label="Copy">${icon("copy", 18)}</button>
  </div>`;
}

/** Copy-button behaviour. Append to any page using copyField. */
export const COPY_SCRIPT = `
(function () {
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var field = document.getElementById(btn.getAttribute('data-copy'));
      if (!field) return;
      field.select();
      field.setSelectionRange(0, 99999);
      var done = function () {
        btn.classList.add('done');
        setTimeout(function () { btn.classList.remove('done'); }, 1200);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(field.value).then(done, function () {});
      } else {
        try { document.execCommand('copy'); done(); } catch (e) {}
      }
    });
  });
})();
`;
