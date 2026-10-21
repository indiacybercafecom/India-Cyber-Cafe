# Reusable & Embeddable PDF Viewer Architecture

Production-grade, embed-friendly PDF viewer endpoint providing direct full-screen document viewing and isolated iframe embedding (`embed=1`) with complete toolbars, fast PDF rendering, and parent-window close communication.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were confirmed through Phase 1 clarification:
> - **Close Button Behavior in Embedded Mode**: In `embed=1` / iframe mode, the top close button is preserved. Instead of redirecting to India Cyber Cafe's internal navigation or home page, it dispatches a structured `postMessage` event (`{ type: 'ICC_PDF_VIEWER_CLOSE', source: 'icc-pdf-viewer' }`) to the parent host window. This allows third-party embedding sites to dismiss the iframe/modal cleanly without trapping the user inside an internal ICC route.
> - **Iframe Domain Embedding Policy**: Configured with a permissive embedding policy (`Content-Security-Policy: frame-ancestors *`) to allow authorized partner portals, government service aggregators, and public websites to embed documents seamlessly.
> - **Full Toolbar Capabilities**: Both standalone direct viewing and embedded iframe viewing will retain full toolbar utility: multi-page navigation (`Prev`/`Next`/counter), precision zoom controls (`-`/`+`/presets), 90-degree page rotation, print handling, and direct PDF file downloading.

---

### 1. Overview & Core Concept

- **What It Does**: Transforms document routes (e.g. `/forms-documents/:categorySlug/:pdfSlug`) into a dual-mode viewer endpoint. Direct visits load an instant full-screen PDF viewer without intermediate homepage or catalog redirects. Adding `?embed=1` (or loading inside an iframe) activates embed mode, completely stripping navigation headers, sidebars, and footers while preserving the document title, responsive canvas, and toolbar.
- **Target Audience / Persona**: Citizens and cyber cafe operators accessing forms directly, as well as external web applications, e-governance kiosks, and service portals embedding India Cyber Cafe government forms and applications.
- **Key Value**: Eliminates intermediate navigation latency, prevents iframe layout breakage caused by surrounding website chrome, and provides a standardized, responsive document viewing API with zero external dependencies for third-party host pages.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. *Direct Standalone Viewer (`/forms-documents/:cat/:slug?from=...`)*:
     - User navigates to the document URL.
     - The page immediately displays the document header and PDF rendering canvas.
     - Clicking the close button honors the `from` query parameter or smoothly returns to the parent forms catalog.
  2. *Embedded Iframe Mode (`/forms-documents/:cat/:slug?embed=1`)*:
     - Third-party site embeds the URL inside an `<iframe src="https://b.indiacybercafe.com/forms-documents/...?embed=1">`.
     - India Cyber Cafe header, footer, navigation bar, and outer layout paddings are suppressed.
     - The document title and full action bar render flush to the iframe boundaries.
     - Clicking the close button dispatches a postMessage to the parent page and optionally attempts `window.parent.postMessage`.
  3. *Error & Fallback Flow*:
     - If a document is missing or a remote PDF cannot be fetched, an in-frame error state appears with diagnostic guidance and a direct download button.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Clean, utilitarian document workbench adhering to India Cyber Cafe's established civic navy styling (`#001A57`) with high-contrast text and crisp boundaries.
  - *Color Palette & Mood*:
    - Header Bar: Deep navy gradient (`from-[#001A57] to-[#0A2E80]`) with pure white typography.
    - Toolbar Surface: Soft slate neutral (`#F8FAFC`) with subtle hairline dividers (`#E2E8F0`).
    - Canvas Backdrop: Balanced neutral slate (`#E2E8F0`) providing optimal edge contrast for white A4/Letter PDF sheets.
    - Primary Interactive Accents: Crisp navy buttons with subtle hover lift and accessible focus rings.
  - *Typography & Hierarchy*:
    - Document Title: Semi-bold display sans-serif (`text-base sm:text-lg text-white font-bold`).
    - Toolbar Controls: Compact, tabular counters (`text-xs sm:text-sm font-semibold text-slate-700`).
  - *Component Styling & Layout*:
    - Full viewport utilization (`h-screen w-screen`) with zero overflow on parent window.
    - Responsive toolbar with overflow-scrolling on small mobile viewports to prevent icon truncation.

- **Interactive Feedback & Motion**:
  - Immediate spinner overlay during initial worker bootstrapping and canvas rendering.
  - Smooth page flip transitions with debounced scale transforms.
  - Native print triggers with specialized handling for mobile webview compatibility.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: URL Query Contract vs Dedicated Route**:
  - *Chosen Approach*: Support both direct slug routes (`/forms-documents/:categorySlug/:pdfSlug`) and query parameter flags (`embed=1`, `embed=true`, or auto-detection via `window.self !== window.top`).
  - *Why*: Preserves 100% backward compatibility for all existing bookmarks, search engine indexes, and share links while empowering external platforms to request an iframe-optimized view with a single parameter.
  - *Alternatives Considered*: Creating a separate route like `/embed/pdf/...` was rejected because it duplicates document resolution logic and fractures canonical URLs.

- **Decision 2: Direct Parent Message Communication vs Native Redirection**:
  - *Chosen Approach*: In embed mode, the close action issues a cross-origin `window.parent.postMessage` payload and does not navigate the iframe to internal ICC routes.
  - *Why*: Prevents third-party host sites from suddenly rendering India Cyber Cafe's full website inside a constrained 400x500 iframe when an end user simply intended to close a modal preview.
  - *Alternatives Considered*: Standard `history.back()` fails if the user arrived at the iframe directly without internal browsing history.

- **Decision 3: Server-Side Proxy vs Direct Client Fetching**:
  - *Chosen Approach*: Retain and harden the existing `/api/pdf-proxy` endpoint with permissive origin handling, streaming responses, and proper MIME enforcement.
  - *Why*: Circumvents third-party CORS limitations on external government storage buckets and cloud drives while shielding origin URLs.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Client Application                            │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │               App Root & Route Coordinator                     │   │
│   │    - Inspects URL query (?embed=1) & iframe nesting            │   │
│   │    - Conditionally suppresses Navbar, Sidebar, and Footer      │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │               Document Viewer Endpoint Component               │   │
│   │    - Resolves category & document slugs via useDocuments()    │   │
│   │    - Renders instant full-screen viewport layout               │   │
│   │    - Emits parent postMessage on close in embed mode           │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                     PDF Viewer Modal Engine                    │   │
│   │    - PDF.js Web Worker thread initialization                   │   │
│   │    - Canvas viewport rendering with device pixel scaling       │   │
│   │    - Navigation, zoom, rotation, print, & download toolbar     │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │
                                    │ /api/pdf-proxy?url=...
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Express Node.js Server                          │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                     Security & Frame Policy                    │   │
│   │    - Content-Security-Policy: frame-ancestors *                │   │
│   │    - CORS headers for embeddable assets and proxy streams      │   │
│   └────────────────────────────────────────────────────────────────┘   │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                     Streaming PDF Proxy Route                  │   │
│   │    - HTTPS validation & streaming buffer pipeline              │   │
│   │    - Public cache headers (Cache-Control: public, max-age=300) │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `isEmbedMode`: Evaluates `Boolean(searchParams.get('embed') === '1' || searchParams.get('embed') === 'true' || window.self !== window.top)`.
  - `document`: Resolved via document catalog cache or real-time query by slug.
  - `viewerState`: Page index, total page count, zoom multiplier (0.5x to 2.5x), degree rotation (0, 90, 180, 270), and loading/rendering phase indicators.

- **Interactive Component & State Mapping**:
  - `Close Control`:
    - Standalone Mode: Executes router transition to `from` path or `/forms-documents`.
    - Embed Mode: Executes `window.parent.postMessage({ type: 'ICC_PDF_VIEWER_CLOSE', source: 'icc-pdf-viewer' }, '*')` and falls back to window dismissal.
  - `Page Navigation`: Decrements/increments active page state with bound clamping; triggers re-render pipeline on PDF.js canvas context.
  - `Zoom Controls`: Increments scale factor by 0.1 increments, recalculating viewport pixel transform.
  - `Print Action`: Opens dedicated printable proxy window with automated print triggers.
  - `Download Action`: Direct anchor download pointing to binary proxy attachment stream.
