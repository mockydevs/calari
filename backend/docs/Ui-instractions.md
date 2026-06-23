Build a next-level, production-grade Staff Portal web application using the latest 
Bootstrap 5 (CDN), with a sleek, modern tech-company aesthetic. The UI should feel 
like a premium SaaS product — not a generic admin template.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 COLOR PALETTE — TECH DARK THEME
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use these CSS variables throughout:

--bg-base:        #0A0E1A   /* Deep space black — main background */
--bg-surface:     #111827   /* Card/panel surfaces */
--bg-elevated:    #1C2333   /* Hover states, dropdowns */
--accent-primary: #4F8EF7   /* Electric blue — primary CTA, highlights */
--accent-cyan:    #00D4FF   /* Neon cyan — badges, active states */
--accent-violet:  #7C3AED   /* Purple — secondary accents, gradients */
--accent-green:   #10B981   /* Emerald — success, online status */
--accent-amber:   #F59E0B   /* Amber — warnings, notifications */
--text-primary:   #F1F5F9   /* Main text */
--text-muted:     #64748B   /* Subtitles, labels */
--border:         rgba(255,255,255,0.07) /* Subtle glass borders */

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 CDN DEPENDENCIES (include ALL in <head>)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Bootstrap 5.3 CSS + JS Bundle (latest CDN)
2. Bootstrap Icons 1.11+ (CDN) — use bi-* classes
3. Google Fonts: "Plus Jakarta Sans" (weights 300,400,500,600,700)
   as body font + "Syne" (700,800) as display/heading font
4. No jQuery. Vanilla JS only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏗️ LAYOUT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Full-screen layout with:

LEFT SIDEBAR (260px, fixed)
- Company logo with glowing dot indicator
- User avatar with online status ring (gradient border)
- Navigation sections with icon + label:
  · Dashboard (bi-grid-1x2-fill)
  · My Profile (bi-person-fill)
  · Team (bi-people-fill)
  · Projects (bi-kanban-fill)
  · Time & Leave (bi-calendar3)
  · Payslips (bi-receipt)
  · Assets (bi-laptop)
  · Help Desk (bi-headset)
- Sidebar has glassmorphism style: 
  background: rgba(17,24,39,0.85), backdrop-filter: blur(20px)
- Active nav item: left border accent (4px solid var(--accent-cyan)), 
  background glow effect
- Bottom: Settings + Logout with divider

TOP NAVBAR (fixed, 64px)
- Hamburger (mobile), breadcrumb path
- Global search bar (rounded-pill, glassmorphism style, 
  placeholder: "Search people, projects, docs...")
- Right: notification bell (bi-bell-fill) with badge count,
  calendar icon (bi-calendar-event), 
  theme toggle (bi-sun-fill / bi-moon-fill),
  avatar dropdown with role badge

MAIN CONTENT AREA (scrollable)
- Greeting header: "Good morning, [Name] 👋" in Syne font
- Subtitle: date + weather icon + day message

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 DASHBOARD PAGE CONTENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ROW 1 — STAT CARDS (4 columns, Bootstrap grid)
Each card has:
- Glassmorphism background with subtle gradient top-border
- Large icon (Bootstrap Icons, 2rem) in colored circle
- Big number in Syne font (animate count-up with JS)
- Label + percentage change with arrow icon
Cards:
1. Total Staff Online — bi-people-fill — accent-cyan
2. Open Tickets — bi-ticket-fill — accent-amber  
3. Projects Active — bi-kanban-fill — accent-violet
4. Leave Requests — bi-calendar-check-fill — accent-green

ROW 2 — TWO COLUMNS
LEFT (col-8): "Active Projects" table
- Sleek table: no outer borders, row hover glow
- Columns: Project, Team, Progress (animated progress bar 
  with gradient fill), Status badge, Due Date
- Status badges: pill shape — "On Track" (green), 
  "At Risk" (amber), "Delayed" (red)
- Progress bars: gradient from accent-primary to accent-cyan

RIGHT (col-4): "Quick Actions" card
- Bold heading with bi-lightning-fill icon
- 6 action buttons in 2x3 grid, each:
  large Bootstrap Icon, short label below, 
  glassmorphism button style with hover scale + glow
- Actions: Request Leave, View Payslip, Raise Ticket,
  Book Asset, Update Profile, Team Directory

ROW 3 — THREE COLUMNS
1. Team Activity Feed (col-5)
   - Timeline-style list with avatar, name, action, time
   - "Alex just completed Sprint 4 review · 5m ago"
   - Dot connector line between items
   - Avatars with colored status rings

2. Upcoming Events (col-4)
   - Calendar events list with date pill on left
   - Event name, time, type badge
   - Date pill: gradient background matching event type

3. My Attendance (col-3)
   - Mini calendar heatmap for current month
   - Color-coded: Present (green), Absent (red), 
     Leave (amber), Weekend (muted)
   - Today highlighted with pulse animation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ VISUAL EFFECTS & MICRO-INTERACTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Glassmorphism cards: background rgba(28,35,51,0.6), 
  border 1px solid rgba(255,255,255,0.07), 
  backdrop-filter: blur(12px), border-radius: 16px
- Hover on cards: translateY(-4px), box-shadow glow 
  in accent color, transition 0.3s ease
- Sidebar nav hover: slide-in left border + background glow
- Stat cards: animated counter (0 → value on load)
- Progress bars: animate width on load with ease-out
- Notification badge: pulse animation (keyframe scale 1→1.2→1)
- Page load: staggered fade-in-up for each card 
  (animation-delay: 0.1s per card)
- Search bar: focus state with glow border (box-shadow accent-primary)
- Scrollbar: custom thin style (4px, accent-primary color)
- Active sidebar item: subtle animated gradient background

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 RESPONSIVENESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Mobile: sidebar collapses to offcanvas (Bootstrap offcanvas)
- Tablet: sidebar icon-only mode (52px wide, tooltips on hover)
- All Bootstrap grid breakpoints properly handled
- Touch-friendly tap targets (min 44px)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ CODE REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Single HTML file, all CSS in <style>, all JS in <script>
- Use CSS custom properties (variables) for the entire palette
- Bootstrap classes as the foundation, custom CSS on top
- Realistic placeholder data (names, numbers, percentages)
- Functional theme toggle (dark/light) using a data-theme 
  attribute on <html>
- Smooth scrollbar behavior: html { scroll-behavior: smooth }
- All Bootstrap Icons loaded from CDN — no SVG files
- Zero external JS libraries except Bootstrap Bundle