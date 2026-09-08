# India Cyber Cafe Design System

## 1. Product Direction

India Cyber Cafe is a trusted digital service counter for citizens who need help with online applications, government forms, document services, printing, payments, and everyday cyber cafe tasks.

The experience should feel:

- **Trustworthy:** clear prices, visible status, secure handling of personal information.
- **Approachable:** plain language and friendly guidance for people with different levels of digital confidence.
- **Efficient:** users should be able to find a service, understand the next step, and complete an action quickly.
- **Indian and civic-minded:** use saffron and navy as restrained brand signals, supported by a modern neutral interface rather than decorative flag imagery.

Do not make the product feel like a government portal, a banking dashboard, or a festival landing page. It is a practical, human-assisted service desk.

## 2. Brand Expression

### Personality

Confident, helpful, precise, respectful, and locally familiar.

### Voice

- Use short, direct sentences.
- Prefer familiar words: “Upload document” instead of “Provide documentation”.
- State costs and processing times before the user commits.
- Explain errors with a next action.
- Use English for the primary interface, with room for future Hindi and regional-language translations.

### Logo and identity

- Use the India Cyber Cafe wordmark in the navbar and footer.
- Keep the wordmark on a clean background with adequate clear space equal to the height of the capital “I”.
- Use saffron for action and energy; use navy for trust, headings, and navigation.
- Avoid adding flags, Ashoka Chakra illustrations, or ornamental tricolor stripes to every component. Brand signals should remain deliberate.

## 3. Color Palette

Use color semantically. The palette below is the source of truth for new UI work.

### Brand colors

| Token | Hex | RGB | Use |
| --- | --- | --- | --- |
| `brand-saffron` | `#FF9933` | `255, 153, 51` | Primary actions, active highlights, progress, links on dark surfaces |
| `brand-saffron-dark` | `#E87516` | `232, 117, 22` | Hover and pressed primary actions |
| `brand-navy` | `#000080` | `0, 0, 128` | Main headings, navigation, secondary actions, trust cues |
| `brand-navy-light` | `#4B6CB7` | `75, 108, 183` | Secondary navy surfaces, illustrations, selected accents |

### Supporting colors

| Token | Hex | RGB | Use |
| --- | --- | --- | --- |
| `surface-page` | `#F8FAFC` | `248, 250, 252` | App background |
| `surface-card` | `#FFFFFF` | `255, 255, 255` | Cards, modals, forms, tables |
| `surface-muted` | `#F1F5F9` | `241, 245, 249` | Input backgrounds, inactive areas, skeletons |
| `ink-strong` | `#0F172A` | `15, 23, 42` | Main body text and headings |
| `ink-muted` | `#475569` | `71, 85, 105` | Supporting copy and metadata |
| `border` | `#E2E8F0` | `226, 232, 240` | Dividers, input borders, card borders |
| `border-strong` | `#CBD5E1` | `203, 213, 225` | Focus-adjacent borders and table rules |

### Status colors

| Token | Hex | Use |
| --- | --- | --- |
| `status-success` | `#15803D` | Completed, verified, available |
| `status-success-bg` | `#DCFCE7` | Success badges and callouts |
| `status-warning` | `#B45309` | Pending, needs attention, expiring |
| `status-warning-bg` | `#FEF3C7` | Warning badges and callouts |
| `status-danger` | `#B91C1C` | Failed, destructive, rejected |
| `status-danger-bg` | `#FEE2E2` | Error badges and destructive callouts |
| `status-info` | `#0369A1` | Informational messages and processing |
| `status-info-bg` | `#E0F2FE` | Informational callouts |

### Color rules

- Use `brand-saffron` for one primary action per view whenever possible.
- Use navy for navigation and secondary actions, not for every surface.
- Keep body text at `ink-strong` or `ink-muted`; never use saffron or navy-light for long paragraphs.
- Do not communicate status with color alone. Pair it with text, an icon, or a status label.
- Text and icons must meet WCAG AA contrast: 4.5:1 for normal text and 3:1 for large text or UI boundaries.
- On saffron surfaces, use `ink-strong` or navy text when contrast testing allows it; avoid small white text on bright saffron.

## 4. Typography

### Font family

Use **Poppins** throughout the product. It is already configured in `src/index.css`.

Fallback: `ui-sans-serif, system-ui, sans-serif`.

### Type scale

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | `40px / 48px` | 700-800 | Home page headline only |
| Page heading | `32px / 40px` | 700 | Main page title |
| Section heading | `24px / 32px` | 600-700 | Page sections and modal titles |
| Card heading | `18px / 28px` | 600 | Service, product, and order titles |
| Body | `16px / 24px` | 400 | Default reading text |
| Body small | `14px / 20px` | 400-500 | Supporting copy, table content |
| Caption | `12px / 16px` | 500-600 | Metadata, labels, timestamps |
| Button | `14px / 20px` | 600-700 | Actions and controls |

- Keep letter spacing at `0`.
- Use sentence case for labels, buttons, and headings.
- Use uppercase only for compact status badges or short metadata labels.
- Keep text blocks to roughly 60-75 characters per line on larger screens.

## 5. Layout and Spacing

### Container

- Maximum content width: `1200px`.
- Horizontal gutter: `16px` on mobile, `24px` on tablet, `32px` on desktop.
- Use full-width bands for page sections with a constrained inner container.
- Keep the primary action visible near the content it affects.

### Spacing scale

Use a 4px base unit:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px`

- Form fields: `16px` vertical gap.
- Related controls: `8px` gap.
- Card internal padding: `16px` mobile, `24px` desktop.
- Section separation: `48px` mobile, `64px` desktop.

### Responsive behavior

- **Mobile:** single-column layouts, full-width primary actions, compact table rows converted to stacked cards.
- **Tablet:** two-column service and product grids where content remains readable.
- **Desktop:** use two-column layouts for discovery plus detail, and three- or four-column grids for repeated services.
- Never allow buttons, badges, or form labels to overflow their containers.
- Preserve a minimum touch target of `44px` by `44px`.

## 6. Surfaces, Shape, and Elevation

### Radius

- Small controls and inputs: `12px`.
- Cards and panels: `16px`.
- Large feature surfaces and modals: `24px`.
- Pills: use only for statuses, filters, and compact tags.

Avoid excessive rounded containers and never place a card inside another card unless the inner object is a clearly separate repeated item.

### Shadows

```css
--shadow-sm: 0 1px 2px rgb(15 23 42 / 0.06);
--shadow-md: 0 8px 24px rgb(15 23 42 / 0.10);
--shadow-lg: 0 16px 40px rgb(15 23 42 / 0.14);
```

Use borders for structure and shadows for hierarchy. Hover elevation should be subtle and must not move nearby content.

## 7. Core Components

### Navbar

- White surface with a thin bottom border.
- Wordmark on the left; primary navigation in the middle; account and primary action on the right.
- Collapse navigation into a menu on mobile.
- Keep the active route visually obvious with navy text and a saffron indicator.

### Buttons

- **Primary:** saffron background, strong readable text, one per major workflow.
- **Secondary:** navy outline or navy text on a neutral surface.
- **Tertiary:** text-only action for low-priority operations.
- **Destructive:** danger color, always paired with confirmation for irreversible actions.
- Include a familiar icon when it improves scanning, but keep the text label for important actions.
- States: default, hover, focus-visible, pressed, disabled, and loading.

### Cards

Use cards for services, products, documents, orders, and reviews. Each card needs a clear title, concise supporting information, and one obvious next action. Avoid filling cards with decorative copy.

### Forms

- Label every field visibly.
- Show required state before submission.
- Use helper text for format, file size, or privacy requirements.
- Keep validation next to the relevant field and preserve the user’s input.
- Use a review step before payment or final submission.

### Tables and lists

- Use tables for comparison and admin workflows, not on narrow mobile screens.
- Align numbers and prices consistently.
- Keep row actions in a predictable final column.
- Provide empty, loading, error, and pagination states.

### Modals and drawers

- Use a modal for focused confirmation, authentication, payment, and document preview.
- Use a drawer for filters or contextual details on mobile.
- Include a clear title, close control, focus management, and an escape-key path.
- Destructive confirmations state exactly what will happen.

### Status badges

Use the status tokens above with a text label such as `Pending`, `Completed`, `Rejected`, or `Needs review`. Badges should supplement, never replace, the surrounding explanation.

## 8. Page Patterns

### Home

Show the service search or primary service categories immediately. Follow with popular services, a simple “how it works” sequence, trust signals, and a contact/help route.

### Services and service detail

Use category filters, searchable service cards, transparent pricing, expected turnaround, required documents, and a strong “Start application” action.

### Store and product detail

Show product image, title, price, availability, delivery or pickup information, quantity, and checkout action without burying the purchase controls.

### Apply and checkout

Use a visible step indicator: `Details`, `Documents`, `Review`, `Payment`, `Confirmation`. Keep entered data recoverable and summarize totals before payment.

### Track and profile

Prioritize current status, reference number, next action, and support contact. Use timeline patterns for application progress.

### Admin and operator views

Favor dense, scannable layouts: summary metrics, filters, tables, status badges, and clearly separated approval or management actions. Avoid marketing-style hero layouts.

## 9. Interaction and Motion

- Use `150-200ms` for hover, focus, and color transitions.
- Use `250-350ms` for modal and page-section entrances.
- Prefer opacity and small vertical translation over large movement.
- Provide `prefers-reduced-motion` behavior that removes non-essential animation.
- Loading states must preserve layout dimensions and communicate what is loading.
- Never use motion as the only signal that an action succeeded or failed.

## 10. Accessibility and Trust

- Use semantic headings in order and landmarks for navigation, main content, and footer.
- Every interactive element must be keyboard reachable with a visible focus ring.
- Dialogs must trap focus while open and return focus to the triggering control on close.
- Do not expose personal documents, payment details, or application data in decorative previews or URLs.
- Add alt text for meaningful images; mark decorative images as decorative.
- Support zoom to 200% without loss of content or functionality.
- Confirm privacy-sensitive uploads and explain retention or use wherever relevant.

## 11. Iconography and Imagery

- Use the existing icon set for consistent stroke weight and sizing.
- Default icon sizes: `16px` inline, `20px` controls, `24px` feature icons.
- Pair unfamiliar icons with a tooltip or visible label.
- Prefer real service-related imagery and document/product previews over abstract decoration.
- Keep imagery bright, legible, and relevant. Do not use blurred stock photos when users need to inspect an object or document.

## 12. Implementation Tokens

The existing Tailwind theme in `src/index.css` maps the core brand values:

```css
--color-primary: #FF9933;
--color-primary-dark: #E87516;
--color-navy: #000080;
--color-navy-light: #4B6CB7;
```

When adding a new component, start with these tokens and the neutral/status values in this document. Avoid introducing one-off hex values unless the value is required for an external brand asset or a verified accessibility correction.

## 13. Design Review Checklist

- Is the primary action obvious within the first viewport?
- Are price, turnaround, required documents, and status easy to find?
- Does the design work at mobile width without overflow or clipped text?
- Are loading, empty, error, disabled, and success states defined?
- Is color supported by text or icon meaning?
- Does all important text meet WCAG AA contrast?
- Can the complete workflow be used with keyboard and screen reader input?
- Does the page feel like a helpful local service counter: clear, trustworthy, and efficient?
