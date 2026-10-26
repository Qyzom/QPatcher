<div align="center">

# QPatcher

**All-in-one desktop customization, UI perfection, and enhancement suite for GNOME Shell.**  
*Native GNOME 45–51 • Pure ESM JavaScript • Zero External Dependencies • 100% Standalone*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45_--_51-orange.svg)](https://www.gnome.org/)
[![JavaScript](https://img.shields.io/badge/Runtime-GJS_/_ESM-yellow.svg)](https://gjs.guide/)
[![Platform](https://img.shields.io/badge/Platform-Linux_(Wayland_/_X11)-brightgreen.svg)]()

<br/>

</div>

---

### Overview

**QPatcher** is a comprehensive, standalone extension suite for GNOME Shell designed to refine, fix, and elevate your desktop experience. Instead of installing a dozen individual, overlapping, and conflicting extensions for panels, docks, blur, notifications, and screenshot behaviors, QPatcher unifies everything into a single, cohesive, and finely-tuned package.

---

### Key Features and Highlights

#### 1. Topbar (Top Panel)
- **Multi-Monitor Routing**: Place the top panel on any physical display.
- **Force Top Bar in Fullscreen**: Keep the top panel always visible even when applications and video players are running in fullscreen mode.
- **Unified Theming and Opacity**: Choose between Default and Unified Theme Color with customized opacity levels.
- **Transparent in Overview**: Topbar background smoothly fades out when opening the Overview.
- **Uppercase Layout Indicator**: Enforces clean uppercase layout codes (`RU`, `EN`) with persistent synchronization across session modes.
- **Clock and Date Customization**: Toggle weekday display, seconds precision, and full element visibility.

#### 2. Integrated Standalone Dock
- **100% Self-Contained**: Full desktop dock functionality embedded directly into QPatcher — no external `dash-to-dock` required.
- **Lock Screen Isolation**: Docks automatically hide during lock screen and login dialogs without leaking onto secure screens.
- **Zero-Clip Magnification**: Icons expand smoothly from the center (`1.15x`) on hover without getting clipped by container bounds.
- **Notification Badge Controls**: Circular badge geometry with accent coloring and an option to completely hide unread counts across native and Flatpak applications.
- **Single Running Indicator Bar**: Sleek horizontal accent bar under active apps instead of cluttered dots.
- **Removable Media Integration**: Automatic detection and display of mounted USB flash drives and external disks.
- **Desktop Struts and Intellihide**: Choose between fixed desktop reservation or intelligent auto-hiding.

#### 3. Overview and Window Polish
- **Multi-Monitor Wallpaper Blur**: Clones and blurs your active desktop wallpaper behind the Overview across all connected screens.
- **Window Controls Cleanup**: Granular toggles to hide window close buttons, app icons, and title bars.
- **Search and Workspace Controls**: Toggle visibility of the search bar and workspace thumbnail picker.

#### 4. Notifications and DateMenu
- **Symmetrical Notification Center**: Eliminates GNOME's legacy 22px right gap when the calendar column is hidden.
- **Clean Centering**: Centers notification cards and the "Clear All" button for perfect symmetry.
- **Custom Banner Placement**: Route popups to any monitor and choose horizontal alignment (Center, Left, Right).
- **Banner Customization**: Hide the banner close button (X), hide topbar bell icons, and adjust auto-dismiss timeouts.

#### 5. Quick Settings Enhancements
- **Odd-Tile Full Width**: Automatically stretches the last odd toggle card across two columns for a balanced grid.
- **Persistent Grid Monitoring**: Prevents layout regressions when Bluetooth or Wi-Fi devices connect or disconnect.
- **System Buttons Toggle**: Show or hide round action buttons (Power, Lock, Settings, Screenshot).

#### 6. Native Screenshot Interception
- **Clean Screen Start**: Clears default pre-selected rectangles on open, letting you drag clean selections from scratch.
- **Drag-to-Capture (Instant Release)**: Capture immediately upon completing an area selection without pressing Enter.
- **Direct Low-Latency Audio Playback**: Plays shutter sounds or neutral bubble clicks directly via PipeWire (`pw-play`) or PulseAudio (`paplay`), bypassing system libcanberra issues.
- **Flexible Naming**: Choose between 6 random digits (`482910.png`), clean timestamps (`2026-10-25_16.05.30.png`), or default GNOME filenames.
- **Direct Pictures Folder**: Option to save directly into `~/Pictures` instead of nested subfolders.
- **Clipboard-Only Mode**: Copy screenshots directly to clipboard without cluttering disk storage.

#### 7. Lock Screen and Login Enhancements
- **Keep Monitors Awake (Win + L)**: Prevents displays from blanking or going to sleep when locking the session.
- **Multi-Monitor Lock Screen Wallpapers**: Ensures blurred wallpapers are rendered across all displays, including non-standard vertical and mixed-resolution layouts.
- **Lock Screen Topbar and Date/Clock**: Keeps the topbar active on the chosen display during lock screen and retains full date and time formatting.
- **Direct Password Prompt**: Automatically bypasses the lock screen curtain to focus the password entry immediately.
- **Single-User Auto-Select**: Automatically selects the single system user on the login screen, prompting for the password right away.

#### 8. Unified Theme and Styling
- **Theme Color Palette**: Pick from curated dark presets (Graphite, Charcoal, Slate Blue, Nord Dark, Obsidian) or enter custom HEX codes.
- **All Menus and Dialogs**: Apply matching theme background, borders, and shadows to all popup menus, context menus, and system dialogs.
- **OSD Volume Monitor Selection**: Route volume and brightness on-screen displays to a specific monitor instead of mirroring across all screens when using rotary encoders.

#### 9. Integrated Clipboard History and Emoji Picker
- **Replaces Bulky Third-Party Extensions**: Fully built-in, lightweight clipboard history and emoji selector directly in QPatcher.
- **Two Focused Tabs**: Streamlined interface strictly limited to Clipboard History and Emoji Picker.
- **Fast Global Shortcuts**: Default bindings for Win + V (`<Super>v`) to open Clipboard History and Win + . (`<Super>period`) to open Emoji Picker.
- **Rich Content Support**: Stores and previews text and PNG images with thumbnails, dimensions, and timestamps.
- **Pinning and Pruning**: Pin favorite items to keep them persistent, delete items individually, or clear all unpinned entries. Configurable history capacity (10 to 500 entries).
- **Auto-Paste**: Automatically simulates Shift + Insert via virtual input device upon selecting an item or emoji.
- **Persistence Across Reboots**: Keeps history safely on disk by default, with an optional toggle to clear unpinned items on system boot.
- **Bilingual Emoji Search and Full-Width Grid**: Search emojis in Russian and English with prioritized digit/number emojis and a homogeneous 12-column grid with zero dead zones.
- **Universal Ctrl + A**: Supports full Select All in search inputs across both English and Russian keyboard layouts (`<Control>a` and `<Control>Cyrillic_ef`).

---

### Installation

#### Manual / Local Installation

1. Clone this repository into your GNOME Shell extensions directory:

```bash
git clone https://github.com/Qyzom/QPatcher.git ~/.local/share/gnome-shell/extensions/qpatcher@qybic
```

2. Compile the GSettings schemas:

```bash
cd ~/.local/share/gnome-shell/extensions/qpatcher@qybic
glib-compile-schemas schemas/
cp schemas/*.xml ~/.local/share/glib-2.0/schemas/
glib-compile-schemas ~/.local/share/glib-2.0/schemas/
```

3. Enable the extension:

```bash
gnome-extensions enable qpatcher@qybic
```

4. Reload GNOME Shell:
   - On **Wayland**: Log out and log back in.
   - On **X11**: Press `Alt + F2`, type `r`, and press `Enter`.

---

### Configuration and Preferences

Open the Adwaita preferences window at any time through the **GNOME Extensions** app, or launch it directly via the terminal:

```bash
gnome-extensions prefs qpatcher@qybic
```

You can also use the bundled standalone previewer:

```bash
gjs -m ~/.local/share/gnome-shell/extensions/qpatcher@qybic/preview.js
```

---

### License

This project is licensed under the [MIT License](LICENSE) © 2026 Qyzom.
