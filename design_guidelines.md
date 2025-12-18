# Personal Finance Dashboard - Design Guidelines

## Design Approach

**Selected Approach:** Reference-Based with Design System Foundation

Drawing primary inspiration from **Empower Personal Dashboard, Rocket Money, and Mint**, supplemented by **Material Design** principles for data-heavy interfaces. These applications excel at presenting complex financial data clearly while maintaining visual sophistication.

**Key Design Principles:**
- Data clarity above decoration
- Scannable hierarchies for quick financial insights
- Trust-building through professional polish
- Immediate value visibility (key metrics always prominent)
- Progressive disclosure (details available on demand)

---

## Typography

**Font Stack:** Inter (via Google Fonts CDN)
- Primary: Inter for all UI elements (excellent readability for numbers/data)
- Fallback: system-ui, -apple-system, sans-serif

**Type Scale:**
- Dashboard Headers: text-3xl (30px) / font-bold
- Section Titles: text-xl (20px) / font-semibold
- Card Headers: text-lg (18px) / font-medium
- Body Text: text-base (16px) / font-normal
- Data Labels: text-sm (14px) / font-medium
- Secondary Info: text-xs (12px) / font-normal
- Large Numbers (metrics): text-4xl to text-5xl / font-bold / tabular-nums

**Numeric Display:** Always use `tabular-nums` class for proper alignment of financial figures

---

## Layout System

**Spacing Primitives:** Tailwind units of **2, 4, 6, 8, 12, 16, 20, 24**
- Component padding: p-4 to p-6
- Section spacing: gap-6 to gap-8
- Page margins: px-4 (mobile), px-8 (desktop)
- Card spacing: p-6 on desktop, p-4 on mobile

**Grid System:**
- Dashboard: 12-column grid on desktop, single column on mobile
- Stat cards: grid-cols-2 md:grid-cols-4 for quick metrics
- Chart sections: grid-cols-1 lg:grid-cols-2 for side-by-side comparisons
- Container: max-w-7xl mx-auto for main content area

**Responsive Breakpoints:**
- Mobile-first approach
- md: 768px (tablet)
- lg: 1024px (desktop)
- xl: 1280px (large desktop)

---

## Component Library

### Navigation
**Desktop:** Persistent left sidebar (w-64), collapsible on tablet
- Logo at top
- Primary nav items with icons (Heroicons) and labels
- Active state: subtle background treatment
- Settings/profile at bottom

**Mobile:** Bottom navigation bar with 5 core items
- Overview, Transactions, Categories, Reports, Settings
- Icons from Heroicons (outline for inactive, solid for active)

### Dashboard Cards
**Metric Cards:**
- Rounded corners: rounded-lg
- Subtle shadow: shadow-sm
- Padding: p-6
- Structure: Label (text-sm), Large number (text-3xl/font-bold/tabular-nums), Change indicator (text-sm with up/down icon)
- Change indicators use green/red only for semantic meaning (gains/losses)

**Chart Cards:**
- Same card styling as metric cards
- Header with title and time period selector
- Chart area with generous padding (p-4 internal)
- Legend positioned below chart

### Transaction List
**Table on Desktop:**
- Striped rows for scannability
- Fixed header on scroll
- Columns: Date (w-24), Description (flex-1), Category (w-32), Amount (w-24/text-right/tabular-nums)
- Row height: h-16 for comfortable touch targets

**Card Stack on Mobile:**
- Each transaction as a card with rounded-lg, p-4
- Top row: Description (font-medium) | Amount (font-bold/tabular-nums)
- Bottom row: Date (text-sm) | Category badge (text-xs/rounded-full/px-3/py-1)

### Forms & Inputs
**Input Fields:**
- Height: h-12 for comfortable mobile interaction
- Padding: px-4
- Border: border with rounded-md
- Focus state: ring-2 treatment
- Labels: text-sm/font-medium/mb-2

**Buttons:**
- Primary: h-12, px-6, rounded-lg, font-medium
- Secondary: Same size, border variant
- Icon buttons: w-10 h-10, rounded-lg
- Touch target minimum: 44x44px

### Category Management
**Category Pills:**
- Inline-flex items with icon + label
- rounded-full, px-4, py-2, text-sm
- Editable state shows pencil icon
- Drag handle for reordering (on desktop)

### Filters & Search
**Filter Bar:**
- Sticky positioning below header
- Horizontal scroll on mobile
- Pills for quick filters (Last 30 days, All categories, etc.)
- Search input: w-full md:w-64, rounded-lg, h-10

### Charts & Visualizations
**Using Recharts library:**
- Line charts for trends (cash flow, net worth)
- Pie/Donut charts for category breakdowns
- Bar charts for monthly comparisons
- Consistent sizing: h-64 to h-80
- Tooltips with precise values
- Gridlines: subtle, minimal
- Axes: clean labels, auto-scaled

### Modals & Overlays
**Transaction Detail Modal:**
- max-w-lg on desktop, full-screen on mobile
- Close button: top-right, w-10 h-10
- Content padding: p-6
- Action buttons at bottom

### Account Connection
**Plaid Link Integration:**
- Large "Connect Account" button as primary CTA
- Connected accounts shown as cards with institution logo placeholder
- Status indicators (syncing, error, connected)
- Last sync timestamp: text-xs

### Empty States
- Centered content with icon (w-16 h-16)
- Descriptive text (text-lg/font-medium)
- Helpful subtext (text-sm)
- Primary action button
- Generous vertical padding (py-20)

---

## Animations

**Minimal Motion Approach:**
- Page transitions: None (instant navigation for data apps)
- Loading states: Simple spinner (border-t-transparent animate-spin)
- Chart rendering: Subtle 300ms ease-in for drawing
- Hover states: No animations, instant feedback
- Focus states: Instant ring appearance

**Only Allowed Animation:**
- Number counters on dashboard load (optional, 500ms duration)

---

## Images

**Logo Placeholder:** Top-left of sidebar, 40x40px square with "FD" text or icon
**Institution Logos:** Small circular logos (w-10 h-10) for connected bank accounts - use placeholder divs with institution initials
**Empty State Illustrations:** Simple icon-based (Heroicons), no custom illustrations needed
**No Hero Image:** This is a dashboard app, not a marketing site - users land directly on their data dashboard after login

---

## Dark Mode Strategy

Implement full dark mode toggle in user settings
- System variables for both themes
- Toggle persisted to user preferences
- Smooth theme switching without page reload