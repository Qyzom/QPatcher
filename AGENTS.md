# QPatcher Architecture & Extension Development Memo (AGENTS.md)

Technical architectural memo and guide for developing, maintaining, and extending **QPatcher** — the all-in-one desktop customization, UI perfection, and enhancement suite for **GNOME Shell 45–51** (ESM architecture).

---

## 1. Architectural Overview & Philosophy

QPatcher is designed as a **self-contained, unified GNOME Shell customization suite**. Instead of running a patchwork of conflicting small extensions, QPatcher centralizes and refines core desktop components directly through the GNOME Shell JavaScript / Clutter runtime:

- **100% Standalone**: No external extension dependencies. All dock, panel, notification, screenshot, and theming features run natively within QPatcher.
- **Zero-Leak Lifecycle**: Every Clutter actor, GObject signal, CSS provider, and prototype injection cleanly unwinds when `disable()` is called.
- **Performance-First**: Heavy effects (such as multi-monitor wallpaper blurring) leverage native Clutter actor cloning (`Shell.BlurMode.ACTOR`) rather than CPU-bound background sampling, ensuring 60–144 FPS smoothness across Wayland and X11 sessions.

---

## 2. Component Subsystems

### 2.1. Topbar Subsystem
- **Monitor Placement**: Allows routing the top panel to secondary monitors using `Main.layoutManager.panelBox` translation and layout constraints.
- **Dynamic Theming & Blur**: Applies dynamic CSS classes (`#panel.qpatcher-topbar-theme`, `#panel.qpatcher-topbar-blur`) with theme background color and customizable opacity.
- **Overview Fade**: Seamlessly hides the panel background upon opening the Overview via `Main.overview.connect('showing')` and `transition: background-color 250ms ease-out`.
- **Uppercase Input Source**: Monkey-patches `Keyboard.InputSourceIndicator` to force uppercase language indicators (e.g. `RU`, `EN`) without reverting on layout switch.

### 2.2. Built-in Dock Subsystem
- **Embedded Engine**: Integrated directly into `dock/` with `DockManager`. Replaces the need for a separate `dash-to-dock` installation.
- **Desktop Work Area Struts**: Reserves screen space at the bottom for standard docks, or switches to autohide / intellihide when windows overlap.
- **Center-Pivot Magnification**: Magnification scales icons uniformly from `(0.5, 0.5)` pivot to `1.15` without vertical translation (`translation_y = 0`), preventing clipping against invisible parent boundaries.
- **Refined Notification Badges**: Uses a circular pill shape (`min-width: 18px; min-height: 18px; border-radius: 9999px`) with white glass borders and accent coloring, replacing awkward rectangular badges.
- **Removable Media**: Automatically detects and displays mounted USB and external drives via GIO volume monitors.

### 2.3. Overview Background Pipeline
- **Multi-Monitor Wallpaper Blur**: Clones wallpaper sources across all connected monitors via `Clutter.Clone` and applies `Shell.BlurEffect({ mode: Shell.BlurMode.ACTOR })`.
- **Clean Overview**: Strips default opaque gray fills so the desktop wallpaper blurs smoothly under the workspace switcher.

### 2.4. DateMenu (Notification Center)
- **Asymmetry Fix**: Completely zeroes the legacy 22px right margin hardcoded in GNOME's `.message-view:ltr` and `.message-list:ltr` when the calendar is hidden.
- **Center Alignment**: Centers the "Clear All" (`_clearButton`) button and notification cards for perfect horizontal balance.
- **Compact Empty State**: Hides "No Notifications" text in favor of a sleek, centered bell icon.

### 2.5. Quick Settings
- **Odd-Tile Full Width**: Dynamically detects odd counts of quick toggles (e.g., 5 or 7 tiles) and stretches the last tile across 2 columns (`columnSpan = 2`).
- **Persistent Grid Hooking**: Listens to `qs.menu.connect('open-state-changed')` and `grid.connect('actor-added')` to prevent layout reset when toggles change state.
- **System Buttons Control**: Allows toggling visibility of round system buttons (Power, Lock, Settings, Screenshot).

### 2.6. Native Screenshot Interception Engine
- **In-Memory Capture Pipeline**: Replaces `Main.screenshotUI._saveScreenshot` to route through a custom compositing and storage workflow.
- **Selection Clearing**: Clears default pre-selected rectangles on UI open (`screenshot-clear-selection`) so the user starts with a clean screen.
- **Instant Capture on Mouse Release**: Hooks `areaSelector.connect('drag-ended')` to capture immediately upon releasing the mouse drag without pressing Enter (`screenshot-quick-capture`).
- **Custom Naming & Storage**: Supports 6 random digits (`123456.png`), ISO timestamps (`2026-10-25_16.05.30.png`), or default GNOME names. Allows saving directly into `~/Pictures` or `~/Pictures/Screenshots`.
- **Sound Redirection**: Soft volume-change bubble sound (`audio-volume-change.oga`), silent mode, or default camera shutter.

---

## 3. Extension File Layout

```text
QPatcher/
├── extension.js            # Main GNOME Shell extension lifecycle & runtime hooks
├── prefs.js                # Adwaita preferences window (8 organized tabs)
├── preview.js              # Standalone GUI previewer for preferences testing
├── metadata.json           # Shell extension metadata (UUID, supported versions)
├── stylesheet.css          # Static stylesheets for GNOME Shell widgets
├── qpatcher-dynamic.css    # Dynamically generated runtime CSS (accent & theme colors)
├── LICENSE                 # MIT License
├── README.md               # User documentation & feature showcase
├── AGENTS.md               # This architectural guide
├── schemas/
│   ├── org.gnome.shell.extensions.qpatcher.gschema.xml
│   └── org.gnome.shell.extensions.dash-to-dock.gschema.xml
└── dock/                   # Integrated standalone dock engine
    ├── docking.js          # Core dock manager and lifecycle
    ├── theming.js          # Dock theming, colors, and transparency
    ├── locations.js        # Removable drives, trash, and mounts
    └── ...
```

---

## 4. Development & Maintenance Guidelines

### Schema Compilation
Whenever modifying XML schema files, always compile schemas in both the extension directory and the local GLib schemas directory:

```bash
glib-compile-schemas schemas/
cp schemas/*.xml ~/.local/share/glib-2.0/schemas/
glib-compile-schemas ~/.local/share/glib-2.0/schemas/
```

### Testing Preferences Standalone
You can preview the Adwaita preferences window without opening GNOME Extensions:

```bash
gjs -m preview.js
```

### Commits & Git Conventions
- Write clear, concise commit messages in **English** using conventional prefixes:
  - `feat: ...` for new features or capabilities
  - `fix: ...` for bug fixes and UI corrections
  - `style: ...` for CSS and layout improvements
  - `refactor: ...` for internal structural optimizations
  - `docs: ...` for documentation and metadata updates
