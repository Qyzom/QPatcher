import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WindowPreview from 'resource:///org/gnome/shell/ui/windowPreview.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as UnlockDialogModule from 'resource:///org/gnome/shell/ui/unlockDialog.js';
import * as KeyboardStatus from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { DockManager } from './dock/docking.js';
import { ClipboardHistoryManager, EmojiManager, QPatcherClipboardIndicator } from './clipboard.js';

const TopBarWindowConstraint = GObject.registerClass(
    { Implements: [Meta.ExternalConstraint] },
    class TopBarWindowConstraint extends GObject.Object {
        _init(extension) {
            super._init();
            this._extension = extension;
        }

        vfunc_constrain(window, info) {
            try {
                if (!window || !this._extension) return false;
                if (!this._extension._getSettingBool('panel-visibility', true)) return false;

                const monIndex = window.get_monitor();
                const targetMon = this._extension._getTargetTopbarMonitorIndex();
                if (monIndex !== targetMon) return false;

                const panelBox = Main.layoutManager?.panelBox;
                if (!panelBox || !panelBox.visible) return false;

                const monitors = Main.layoutManager?.monitors;
                if (!monitors || monIndex >= monitors.length) return false;
                const mon = monitors[monIndex];

                const topBarHeight = panelBox.height || 36;
                const topBarY = mon.y + topBarHeight;
                const newRect = info.new_rect;

                if (newRect.y < topBarY) {
                    const diff = topBarY - newRect.y;
                    const newH = Math.max(100, newRect.height - diff);
                    const updatedRect = new Mtk.Rectangle({
                        x: newRect.x,
                        y: topBarY,
                        width: newRect.width,
                        height: newH,
                    });
                    info.set_rect(updatedRect);
                    return true;
                }
            } catch (e) {
                console.error('[QPatcher] TopBarWindowConstraint error:', e);
            }
            return false;
        }
    }
);

export default class QPatcherExtension extends Extension {
    _getUiGroup() {
        return Main.uiGroup || Main.layoutManager?.uiGroup;
    }

    _hexToRgba(hex, alpha) {
        let clean = (hex || '#232326').replace('#', '').trim();
        if (clean.length === 3) {
            clean = clean.split('').map(c => c + c).join('');
        }
        const r = parseInt(clean.substring(0, 2), 16) || 35;
        const g = parseInt(clean.substring(2, 4), 16) || 35;
        const b = parseInt(clean.substring(4, 6), 16) || 38;
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }

    _getSettingBool(key, fallback = false) {
        try {
            if (this._settings?.settings_schema?.has_key(key))
                return this._settings.get_boolean(key);
        } catch (e) {}
        return fallback;
    }

    _getSettingString(key, fallback = '') {
        try {
            if (this._settings?.settings_schema?.has_key(key))
                return this._settings.get_string(key);
        } catch (e) {}
        return fallback;
    }

    _getSettingInt(key, fallback = 0) {
        try {
            if (this._settings?.settings_schema?.has_key(key))
                return this._settings.get_int(key);
        } catch (e) {}
        return fallback;
    }

    _setSettingBool(key, val) {
        try {
            if (this._settings?.settings_schema?.has_key(key))
                this._settings.set_boolean(key, val);
        } catch (e) {}
    }

    enable() {
        this._settings = this.getSettings();
        this._signals = [];

        const getBool = (k, def = false) => this._getSettingBool(k, def);
        const getStr = (k, def = '') => this._getSettingString(k, def);
        const getInt = (k, def = 0) => this._getSettingInt(k, def);

        this._dockAdapter = {
            uuid: this.uuid,
            path: `${this.path}/dock`,
            dir: Gio.File.new_for_path(`${this.path}/dock`),
            metadata: this.metadata,
            getSettings: (schema) => {
                return new Gio.Settings({ schema_id: schema || 'org.gnome.shell.extensions.dash-to-dock' });
            },
            openPreferences: () => {
                this.openPreferences();
            },
        };

        // Внешние системные интерфейсы
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._a11ySettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.a11y' });
        this._shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

        const watchKey = (settings, key, handler) => {
            if (!settings) return;
            try {
                if (settings.settings_schema && !settings.settings_schema.has_key(key)) {
                    return;
                }
                const id = settings.connect(`changed::${key}`, () => {
                    try {
                        handler();
                    } catch (e) {
                        console.warn(`[QPatcher] Error handling change for ${key}:`, e);
                    }
                });
                this._signals.push({ obj: settings, id });
            } catch (e) {
                console.warn(`[QPatcher] Failed to watch key ${key}:`, e);
                return;
            }
            try {
                handler();
            } catch (e) {
                console.warn(`[QPatcher] Error in initial handler for ${key}:`, e);
            }
        };

        const toggleClass = (className, shouldAdd) => {
            const uiGroup = this._getUiGroup();
            if (!uiGroup) return;
            if (shouldAdd) {
                uiGroup.add_style_class_name(className);
            } else {
                uiGroup.remove_style_class_name(className);
            }
        };

        // ==========================================
        // 1. ТОПБАР (TOPBAR)
        // ==========================================

        watchKey(this._settings, 'topbar-monitor', () => {
            this._updatePanelMonitor();
            this._syncDashToDockSettings();
            try {
                for (const actor of global.get_window_actors()) {
                    const metaWin = actor.meta_window;
                    if (metaWin) {
                        metaWin.check_constraints();
                    }
                }
            } catch (_) {}
        });

        watchKey(this._settings, 'dock-monitor', () => {
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'keyboard-uppercase', () => {
            this._updateKeyboardLayoutText();
        });

        watchKey(this._settings, 'clock-show-weekday', () => {
            try {
                this._interfaceSettings.set_boolean('clock-show-weekday', getBool('clock-show-weekday'));
            } catch (e) {}
        });

        watchKey(this._settings, 'clock-show-seconds', () => {
            try {
                this._interfaceSettings.set_boolean('clock-show-seconds', getBool('clock-show-seconds'));
            } catch (e) {}
        });

        // Цвет фона и прозрачность панели
        const updatePanelColor = () => {
            const style = getStr('topbar-style', 'default');
            const opacity = getInt('topbar-opacity', 100) / 100.0;

            if (Main.panel) {
                Main.panel.opacity = Math.round(opacity * 255);
                Main.panel.set_style(null);

                const hasTheme = Main.panel.has_style_class_name('qpatcher-topbar-theme');
                if (style === 'theme-grey') {
                    if (!hasTheme) Main.panel.add_style_class_name('qpatcher-topbar-theme');
                } else {
                    if (hasTheme) Main.panel.remove_style_class_name('qpatcher-topbar-theme');
                }
            }
        };

        watchKey(this._settings, 'topbar-style', () => {
            updatePanelColor();
            this._updateDynamicThemeStylesheet();
        });
        watchKey(this._settings, 'topbar-opacity', () => {
            updatePanelColor();
            this._updateDynamicThemeStylesheet();
        });
        watchKey(this._settings, 'theme-color', () => {
            updatePanelColor();
            this._updateDateMenuStyle();
            this._updateQuickSettingsStyle();
            this._updateNotificationStyle();
            this._updateDynamicThemeStylesheet();
            this._syncDashToDockSettings();
        });
        watchKey(this._settings, 'theme-card-color', () => {
            this._updateDynamicThemeStylesheet();
        });

        // Видимость элементов панели
        watchKey(this._settings, 'panel-visibility', () => {
            if (Main.panel) Main.panel.visible = getBool('panel-visibility', true);
        });

        watchKey(this._settings, 'activities-button', () => {
            const show = getBool('activities-button', true);
            if (Main.panel?.statusArea?.activities) Main.panel.statusArea.activities.visible = show;
        });

        watchKey(this._settings, 'clock-menu', () => {
            if (Main.panel?.statusArea?.dateMenu) Main.panel.statusArea.dateMenu.visible = getBool('clock-menu', true);
        });

        watchKey(this._settings, 'accessibility-menu', () => {
            const show = getBool('accessibility-menu', true);
            try {
                this._a11ySettings.set_boolean('always-show-universal-access-status', show);
            } catch (e) {}

            const a11y = Main.panel?.statusArea?.a11y;
            if (a11y?.container) a11y.container.visible = show;
            else if (a11y) a11y.visible = show;

            const a11y2 = Main.panel?.statusArea?.accessibility;
            if (a11y2?.container) a11y2.container.visible = show;
            else if (a11y2) a11y2.visible = show;

            toggleClass('qpatcher-hide-a11y', !show);
        });

        watchKey(this._settings, 'quicksettings-button', () => {
            const show = getBool('quicksettings-button', true);
            const qs = Main.panel?.statusArea?.quickSettings;
            if (qs?.container) qs.container.visible = show;
        });


        // ==========================================
        // 2. ДОК (DASH & DOCK)
        // ==========================================

        watchKey(this._settings, 'dock-separator-hide', () => {
            const hide = getBool('dock-separator-hide');
            toggleClass('qpatcher-no-dock-separator', hide);
            this._applyDashToDockSeparatorFix(!hide);
        });

        watchKey(this._settings, 'dock-show-apps-hide', () => {
            const hide = getBool('dock-show-apps-hide');
            toggleClass('qpatcher-no-dock-show-apps', hide);
            const dash = Main.overview?.dash || Main.overview?._overview?._controls?._dash;
            if (dash?.showAppsButton) dash.showAppsButton.visible = !hide;
            this._syncDashToDockSettings();
        });

        const updateRunningDotsVisibility = () => {
            const hide = getBool('dock-running-dots-hide');
            const runningBar = getBool('dock-running-indicator-bar');
            const shouldHide = hide && !runningBar;
            toggleClass('qpatcher-no-dock-running-dots', shouldHide);
            const dash = Main.overview?.dash || Main.overview?._overview?._controls?._dash;
            if (dash?._box) {
                for (const item of dash._box.get_children()) {
                    const appIcon = item.child || item;
                    if (appIcon?._dot) appIcon._dot.visible = !shouldHide;
                }
            }
            this._syncDashToDockSettings();
        };

        watchKey(this._settings, 'dock-running-dots-hide', updateRunningDotsVisibility);
        watchKey(this._settings, 'dock-running-indicator-bar', updateRunningDotsVisibility);

        watchKey(this._settings, 'dock-tooltips-hide', () => {
            const hide = getBool('dock-tooltips-hide');
            toggleClass('qpatcher-no-dock-tooltips', hide);
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'dock-notification-badge-hide', () => {
            const hide = getBool('dock-notification-badge-hide');
            toggleClass('qpatcher-hide-dock-notification-badge', hide);
            this._syncDashToDockSettings();
            this._updateDockNotificationBadgesVisibility();
        });

        watchKey(this._settings, 'dock-show-mounts', () => {
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'dock-show-trash', () => {
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'dock-always-visible', () => {
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'dock-intellihide', () => {
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'dock-notification-badge-accent', () => {
            this._updateDynamicThemeStylesheet();
        });

        watchKey(this._settings, 'dock-magnification', () => {
            const enabled = this._getSettingBool('dock-magnification');
            if (!enabled) {
                const dashes = this._getAllDashes();
                for (const dash of dashes) {
                    const box = dash._box || dash;
                    if (box?.get_children) {
                        for (const item of box.get_children()) {
                            const icon = item.child || item;
                            if (icon?.ease) {
                                icon.ease({ scale_x: 1.0, scale_y: 1.0, duration: 100 });
                            }
                        }
                    }
                    if (dash._showAppsIcon?.ease) {
                        dash._showAppsIcon.ease({ scale_x: 1.0, scale_y: 1.0, duration: 100 });
                    }
                }
            } else {
                this._setupDockMagnification();
            }
        });

        watchKey(this._settings, 'dock-icon-size', () => {
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'dock-style', () => {
            this._syncDashToDockSettings();
        });

        watchKey(this._settings, 'dock-opacity', () => {
            this._syncDashToDockSettings();
        });


        // ==========================================
        // 3. ОБЗОР (OVERVIEW) & ОКНА
        // ==========================================

        watchKey(this._settings, 'overview-style', () => {});
        watchKey(this._settings, 'overview-opacity', () => {});

        watchKey(this._settings, 'overview-window-close-button-hide', () => {
            toggleClass('qpatcher-no-window-close', getBool('overview-window-close-button-hide'));
        });

        watchKey(this._settings, 'overview-window-icon-hide', () => {
            toggleClass('qpatcher-no-window-icon', getBool('overview-window-icon-hide'));
        });

        watchKey(this._settings, 'overview-window-title-hide', () => {
            toggleClass('qpatcher-no-window-title', getBool('overview-window-title-hide'));
        });

        watchKey(this._settings, 'overview-search-hide', () => {
            this._updateOverviewSearchVisibility();
        });

        watchKey(this._settings, 'overview-workspace-switcher-hide', () => {
            const hide = getBool('overview-workspace-switcher-hide');
            toggleClass('qpatcher-no-overview-thumbnails', hide);
            const controls = Main.overview?._overview?._controls;
            if (controls?._thumbnailsBox) controls._thumbnailsBox.visible = !hide;
        });


        // ==========================================
        // 4. УВЕДОМЛЕНИЯ (NOTIFICATIONS)
        // ==========================================

        watchKey(this._settings, 'notification-monitor', () => {
            this._updateNotificationPosition();
        });

        watchKey(this._settings, 'notification-horizontal-alignment', () => {
            this._updateNotificationPosition();
        });

        watchKey(this._settings, 'osd-monitor', () => {
            // Checked dynamically in showAll
        });

        watchKey(this._settings, 'notification-close-button-hide', () => {
            toggleClass('qpatcher-no-notification-close', getBool('notification-close-button-hide'));
        });

        watchKey(this._settings, 'panel-notification-icon-hide', () => {
            toggleClass('qpatcher-hide-panel-notification-icon', getBool('panel-notification-icon-hide'));
        });

        watchKey(this._settings, 'notification-style', () => this._updateNotificationStyle());
        watchKey(this._settings, 'notification-opacity', () => this._updateNotificationStyle());


        // ==========================================
        // 5. ШТОРКА (DATEMENU)
        // ==========================================

        const updateDateMenuColumns = () => {
            const dm = Main.panel?.statusArea?.dateMenu;
            if (!dm) return;

            const hideCalendar = getBool('datemenu-calendar-hide');
            const hideWeather = getBool('datemenu-weather-hide');
            const hideClocks = getBool('datemenu-world-clocks-hide');
            const hideEvents = getBool('datemenu-events-hide');

            if (dm._calendar) dm._calendar.visible = !hideCalendar;
            if (dm._date) dm._date.visible = !hideCalendar;
            if (dm._weatherItem) dm._weatherItem.visible = !hideWeather;
            if (dm._clocksItem) dm._clocksItem.visible = !hideClocks;
            if (dm._eventsItem) dm._eventsItem.visible = !hideEvents;

            // Если справа всё скрыто, скрываем колонку целиком и схлопываем окно
            const hasAnyRightItem = (!hideCalendar) || (!hideWeather) || (!hideClocks) || (!hideEvents);

            const calendarCol = dm._calendar?.get_parent() || dm._calendarColumn;
            if (calendarCol) {
                calendarCol.visible = hasAnyRightItem;
            }

            if (!hasAnyRightItem) {
                if (dm._messageList?._clearButton) {
                    dm._messageList._clearButton.x_align = Clutter.ActorAlign.CENTER;
                }
            } else {
                if (dm._messageList?._clearButton) {
                    dm._messageList._clearButton.x_align = Clutter.ActorAlign.START;
                }
            }

            toggleClass('qpatcher-hide-calendar-column', !hasAnyRightItem);
            toggleClass('qpatcher-hide-calendar', hideCalendar);
        };

        watchKey(this._settings, 'datemenu-calendar-hide', updateDateMenuColumns);
        watchKey(this._settings, 'datemenu-weather-hide', updateDateMenuColumns);
        watchKey(this._settings, 'datemenu-world-clocks-hide', updateDateMenuColumns);
        watchKey(this._settings, 'datemenu-events-hide', updateDateMenuColumns);

        watchKey(this._settings, 'datemenu-compact-empty', () => {
            const compact = getBool('datemenu-compact-empty');
            toggleClass('qpatcher-compact-empty-notifications', compact);
            const placeholder = Main.panel?.statusArea?.dateMenu?._messageList?._placeholder;
            if (placeholder?._label) placeholder._label.visible = !compact;
            if (placeholder?._icon) {
                placeholder._icon.y_align = compact ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
            }
        });

        watchKey(this._settings, 'datemenu-style', () => {
            this._updateDateMenuStyle();
            this._updateDynamicThemeStylesheet();
        });
        watchKey(this._settings, 'datemenu-opacity', () => {
            this._updateDateMenuStyle();
            this._updateDynamicThemeStylesheet();
        });


        // ==========================================
        // 6. БЫСТРЫЕ НАСТРОЙКИ (QUICK SETTINGS)
        // ==========================================

        const updateQuickSettingsButtons = () => {
            try {
                const qs = Main.panel?.statusArea?.quickSettings;
                const systemItem = qs?._system?.quickSettingsItems?.[0] || qs?._system?._systemItem;
                const box = systemItem?.child;
                if (!box || !box.get_children) return;

                const hidePower = getBool('qs-power-hide');
                const hideScreenshot = getBool('qs-screenshot-hide');
                const hideSettings = getBool('qs-settings-hide');
                const hideLock = getBool('qs-lock-hide');

                if (systemItem._powerToggle) systemItem._powerToggle.visible = false;
                if (systemItem._laptopSpacer) {
                    systemItem._laptopSpacer.visible = false;
                    systemItem._laptopSpacer.x_expand = false;
                }
                if (systemItem._desktopSpacer) {
                    systemItem._desktopSpacer.visible = true;
                    systemItem._desktopSpacer.x_expand = true;
                }

                const children = box.get_children();
                const settingsIdx = children.findIndex(c =>
                    c.constructor?.name === 'SettingsItem' ||
                    c.icon_name === 'emblem-system-symbolic' ||
                    c.child?.icon_name === 'emblem-system-symbolic'
                );

                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    const type = child.constructor.name;
                    const isPower = type === 'PowerToggle' ||
                                    child.has_style_class_name?.('power-item') ||
                                    child._proxy !== undefined;
                    const isShutdown = type === 'ShutdownItem' || child.icon_name === 'system-shutdown-symbolic';
                    const isScreenshot = type === 'ScreenshotItem' || child.icon_name === 'screenshooter-symbolic';
                    const isSettings = type === 'SettingsItem' || child.icon_name === 'emblem-system-symbolic';
                    const isLock = type === 'LockItem' || child.icon_name === 'changes-prevent-symbolic';
                    const isSpacer = type === 'Actor' || type === 'ClutterActor' || (!isPower && !isShutdown && !isScreenshot && !isSettings && !isLock && child.x_expand !== undefined);

                    if (isPower) {
                        child.visible = false;
                    } else if (isShutdown) {
                        child.visible = !hidePower;
                    } else if (isScreenshot) {
                        child.visible = !hideScreenshot;
                    } else if (isSettings) {
                        child.visible = !hideSettings;
                    } else if (isLock) {
                        child.visible = !hideLock;
                    } else if (isSpacer) {
                        if (settingsIdx !== -1) {
                            child.visible = (i > settingsIdx);
                            child.x_expand = (i > settingsIdx);
                        }
                    }
                }
                box.queue_relayout?.();
            } catch (e) {}
        };

        const qs = Main.panel?.statusArea?.quickSettings;
        if (qs?.menu) {
            const qsOpenId = qs.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) updateQuickSettingsButtons();
            });
            this._signals.push({ obj: qs.menu, id: qsOpenId });
        }

        watchKey(this._settings, 'qs-power-hide', updateQuickSettingsButtons);
        watchKey(this._settings, 'qs-screenshot-hide', updateQuickSettingsButtons);
        watchKey(this._settings, 'qs-settings-hide', updateQuickSettingsButtons);
        watchKey(this._settings, 'qs-lock-hide', updateQuickSettingsButtons);

        // Растягивание нечетной плитки на всю ширину
        watchKey(this._settings, 'quicksettings-full-width-toggle', () => {
            this._applyQuickSettingsFullWidth();
        });
        watchKey(this._settings, 'quicksettings-background-apps-full-width', () => {
            this._applyQuickSettingsFullWidth();
        });

        watchKey(this._settings, 'quicksettings-style', () => {
            this._updateQuickSettingsStyle();
            this._updateDynamicThemeStylesheet();
        });
        watchKey(this._settings, 'quicksettings-opacity', () => {
            this._updateQuickSettingsStyle();
            this._updateDynamicThemeStylesheet();
        });


        watchKey(this._settings, 'screenshot-show-pointer', () => {
            if (Main.screenshotUI?._showPointerButton) {
                Main.screenshotUI._showPointerButton.checked = getBool('screenshot-show-pointer');
            }
        });

        // ==========================================
        // 7. ПРОЧЕЕ (SYSTEM & ACCENT)
        // ==========================================

        watchKey(this._settings, 'dark-mode', () => {
            const target = getBool('dark-mode', true) ? 'prefer-dark' : 'default';
            if (this._interfaceSettings.get_string('color-scheme') !== target) {
                this._interfaceSettings.set_string('color-scheme', target);
            }
        });

        watchKey(this._settings, 'lockscreen-prevent-blank', () => {
            // ScreenShield activate hook automatically inspects the setting
        });

        watchKey(this._settings, 'topbar-show-in-fullscreen', () => {
            this._setupForceTopBarPatch();
        });

        watchKey(this._settings, 'lockscreen-topbar-enable', () => {
            this._updatePanelMonitor();
            this._updateLockScreenDateMenu();
        });

        watchKey(this._settings, 'lockscreen-auto-focus-password', () => {
            // ScreenShield lock-screen-shown hook automatically inspects the setting
        });

        watchKey(this._settings, 'recolor-all-menus-and-dialogs', () => {
            this._updateDynamicThemeStylesheet();
        });

        watchKey(this._settings, 'menus-dialogs-style', () => {
            this._updateDynamicThemeStylesheet();
        });

        watchKey(this._settings, 'notification-style', () => {
            this._updateDynamicThemeStylesheet();
            this._updateNotificationStyle();
        });

        watchKey(this._settings, 'notification-opacity', () => {
            this._updateDynamicThemeStylesheet();
            this._updateNotificationStyle();
        });

        watchKey(this._settings, 'topbar-transparent-in-overview', () => {});

        if (Main.overview) {
            this._overviewShowingId = Main.overview.connect('showing', () => {
                if (getBool('topbar-transparent-in-overview') && Main.panel) {
                    Main.panel.add_style_class_name('qpatcher-topbar-transparent-in-overview');
                }
            });
            this._overviewHidingId = Main.overview.connect('hiding', () => {
                if (Main.panel) {
                    Main.panel.remove_style_class_name('qpatcher-topbar-transparent-in-overview');
                }
            });
            this._signals.push({ obj: Main.overview, id: this._overviewShowingId });
            this._signals.push({ obj: Main.overview, id: this._overviewHidingId });
        }

        const watchContainer = (container) => {
            if (!container) return;
            const id = container.connect('child-added', (_, child) => {
                if (!child) return;
                if (child.name === 'dashtodockContainer' || (child.has_style_class_name && child.has_style_class_name('dashtodockContainer'))) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._syncDashToDockSettings();
                        this._setupDockMagnification();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
            this._signals.push({ obj: container, id });
        };
        watchContainer(Main.uiGroup);
        watchContainer(global.stage);

        if (Main.layoutManager) {
            if (Main.layoutManager._startingUp) {
                const startId = Main.layoutManager.connect('startup-complete', () => {
                    this._setupDockMagnification();
                });
                this._signals.push({ obj: Main.layoutManager, id: startId });
            }
        }

        watchKey(this._settings, 'accent-color', () => {
            this._updateDynamicThemeStylesheet();
            this._syncDashToDockSettings();
        });

        this._signals.push({
            obj: this._interfaceSettings,
            id: this._interfaceSettings.connect('changed::accent-color', () => {
                this._updateDynamicThemeStylesheet();
                this._syncDashToDockSettings();
            })
        });

        if (Main.layoutManager) {
            const monChangeId = Main.layoutManager.connect('monitors-changed', () => {
                this._updateNotificationPosition();
                this._updatePanelMonitor();
            });
            this._signals.push({ obj: Main.layoutManager, id: monChangeId });
        }

        if (Main.sessionMode) {
            const sessModeId = Main.sessionMode.connect('updated', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    const mode = Main.sessionMode.currentMode;
                    const isLocked = mode === 'unlock-dialog' || mode === 'gdm';
                    this._updateDockVisibilityForSession(isLocked);
                    if (isLocked) {
                        if (this._getSettingBool('lockscreen-topbar-enable', true)) {
                            this._updatePanelMonitor();
                            this._updateLockScreenDateMenu();
                            this._updateKeyboardLayoutText();
                        }
                        this._syncLockScreenBackgrounds();
                    } else {
                        this._updatePanelMonitor();
                        this._updateKeyboardLayoutText();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            });
            this._signals.push({ obj: Main.sessionMode, id: sessModeId });
        }

        // Первичная инициализация всех стилей и эффектов
        updatePanelColor();
        this._updatePanelMonitor();
        this._syncDashToDockSettings();
        this._updateDateMenuStyle();
        this._updateQuickSettingsStyle();
        updateQuickSettingsButtons();
        this._updateNotificationStyle();
        this._updateNotificationPosition();
        this._applyQuickSettingsFullWidth();
        this._updateDynamicThemeStylesheet();

        // Инициализация видимости строки поиска в обзоре
        this._setupOverviewSearchHooks();
        this._updateOverviewSearchVisibility();

        // Устанавливаем надежные хуки на прототипы и индикаторы
        this._setupKeyboardManagerHook();
        this._setupClassPrototypePatches();
        this._setupDockMagnification();
        this._setupForceTopBarPatch();
        this._setupScreenShieldPatch();
        this._setupOsdMonitorPatch();
        this._setupScreenshotCustomizations();
        this._updateLockScreenDateMenu();

        if (!this._origUpdateBoxes && Main.layoutManager?._updateBoxes) {
            this._origUpdateBoxes = Main.layoutManager._updateBoxes;
            const self = this;
            Main.layoutManager._updateBoxes = function() {
                self._origUpdateBoxes.call(this);
                self._updatePanelMonitor();
            };
        }
        this._setupWindowConstraints();

        // Поэтапные проходы инициализации увеличения дока после перезагрузки
        [400, 1200, 2500, 5000].forEach(delay => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._setupDockMagnification();
                return GLib.SOURCE_REMOVE;
            });
        });

        // Инициализация менеджера буфера обмена и эмодзи
        try {
            this._clipboardHistoryManager = new ClipboardHistoryManager(this, this._settings);
            this._clipboardHistoryManager.start();
            this._emojiManager = new EmojiManager(this);
            this._clipboardIndicator = new QPatcherClipboardIndicator(this, this._clipboardHistoryManager, this._emojiManager);

            // Нативный элемент в правой части топбара (как Vitals / AIO Clipboard)
            Main.panel.addToStatusArea('qpatcher-clipboard', this._clipboardIndicator, 1, 'right');

            const syncClipboardIndicatorVis = () => {
                if (this._clipboardIndicator) {
                    this._clipboardIndicator.visible = this._getSettingBool('clipboard-topbar-icon', true);
                }
            };
            syncClipboardIndicatorVis();
            watchKey(this._settings, 'clipboard-topbar-icon', syncClipboardIndicatorVis);

            // Регистрация глобальных горячих клавиш
            Main.wm.addKeybinding(
                'clipboard-shortcut',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => {
                    if (this._clipboardIndicator) {
                        this._clipboardIndicator.openTab('clipboard');
                    }
                }
            );

            Main.wm.addKeybinding(
                'emoji-shortcut',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => {
                    if (this._clipboardIndicator) {
                        this._clipboardIndicator.openTab('emoji');
                    }
                }
            );

            // Экспорт DBus метода для внешнего вызова из терминала / бинда / скрипта
            const ifaceXml = `
            <node>
              <interface name="org.gnome.Shell.Extensions.QPatcher">
                <method name="OpenClipboard">
                  <arg type="s" direction="in" name="tab"/>
                </method>
              </interface>
            </node>`;
            const nodeInfo = Gio.DBusNodeInfo.new_for_xml(ifaceXml);
            this._dbusRegistrationId = Gio.DBus.session.register_object(
                '/org/gnome/Shell/Extensions/QPatcher',
                nodeInfo.interfaces[0],
                (conn, sender, path, iface, method, params, invocation) => {
                    if (method === 'OpenClipboard') {
                        const [tab] = params.deep_unpack();
                        if (this._clipboardIndicator) {
                            this._clipboardIndicator.openTab(tab || 'clipboard');
                        }
                        invocation.return_value(null);
                    }
                },
                null,
                null
            );
        } catch (e) {
            console.error('[QPatcher] Failed to initialize Clipboard & Emoji manager:', e);
        }

        // Автоматическая блокировка экрана при старте системы (если настроен автологин)
        if (this._getSettingBool('autologin-lock-on-boot', false)) {
            try {
                const [, uptimeContent] = GLib.file_get_contents('/proc/uptime');
                const uptimeSec = parseFloat(new TextDecoder().decode(uptimeContent).split(' ')[0]);
                if (uptimeSec < 75) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                        if (Main.screenShield && !Main.screenShield.locked) {
                            Main.screenShield.lock(true);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } catch (e) {
                console.error('[QPatcher] Error checking uptime for autologin lock on boot:', e);
            }
        }
    }

    _getAccentHex() {
        const accentMap = {
            'blue': '#3584e4',
            'teal': '#2190a4',
            'green': '#3a944a',
            'yellow': '#c88800',
            'orange': '#ed5b00',
            'red': '#e62d42',
            'pink': '#d53b8c',
            'purple': '#9141ac',
            'slate': '#5e6f82',
        };
        const cur = this._interfaceSettings?.get_string('accent-color') || this._getSettingString('accent-color') || 'blue';
        return accentMap[cur] || '#3584e4';
    }

    _parseHex(hex) {
        if (!hex || typeof hex !== 'string') return { r: 35, g: 35, b: 38 };
        let h = hex.replace('#', '').trim();
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (h.length !== 6) return { r: 35, g: 35, b: 38 };
        return {
            r: parseInt(h.substring(0, 2), 16) || 0,
            g: parseInt(h.substring(2, 4), 16) || 0,
            b: parseInt(h.substring(4, 6), 16) || 0,
        };
    }

    _mixColors(c1, c2, weight) {
        const w2 = Math.max(0, Math.min(1, weight));
        const w1 = 1 - w2;
        const r = Math.round(c1.r * w1 + c2.r * w2);
        const g = Math.round(c1.g * w1 + c2.g * w2);
        const b = Math.round(c1.b * w1 + c2.b * w2);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    _updateDynamicThemeStylesheet() {
        try {
            const themeColor = this._getSettingString('theme-color', '#232326');
            const customCardColor = this._getSettingString('theme-card-color')?.trim();
            const topbarOpacity = this._getSettingInt('topbar-opacity', 100) / 100.0;
            const notifStyle = this._getSettingString('notification-style', 'theme-grey');
            const notifOpacity = this._getSettingInt('notification-opacity', 100) / 100.0;
            const menusStyle = this._getSettingString('menus-dialogs-style', 'theme-grey');
            const accentHex = this._getAccentHex();
            const recolorMenus = this._getSettingBool('recolor-all-menus-and-dialogs', true);
            const badgeAccent = this._getSettingBool('dock-notification-badge-accent', false);

            const baseRgb = this._parseHex(themeColor);
            const white = { r: 255, g: 255, b: 255 };
            const black = { r: 0, g: 0, b: 0 };

            let cardBg, cardHoverBg, cardActiveBg, sliderTroughBg;
            if (customCardColor && customCardColor.startsWith('#') && (customCardColor.length === 4 || customCardColor.length === 7)) {
                const cardRgb = this._parseHex(customCardColor);
                cardBg = customCardColor;
                cardHoverBg = this._mixColors(cardRgb, white, 0.12);
                cardActiveBg = this._mixColors(cardRgb, white, 0.20);
                sliderTroughBg = this._mixColors(cardRgb, black, 0.25);
            } else {
                cardBg = this._mixColors(baseRgb, white, 0.09);
                cardHoverBg = this._mixColors(baseRgb, white, 0.18);
                cardActiveBg = this._mixColors(baseRgb, white, 0.26);
                sliderTroughBg = this._mixColors(baseRgb, black, 0.25);
            }

            const uiGroup = this._getUiGroup();
            if (uiGroup) {
                if (recolorMenus || menusStyle === 'theme-grey') {
                    uiGroup.add_style_class_name('qpatcher-recolor-menus');
                    uiGroup.add_style_class_name('qpatcher-menus-theme');
                } else {
                    uiGroup.remove_style_class_name('qpatcher-recolor-menus');
                    uiGroup.remove_style_class_name('qpatcher-menus-theme');
                }

                if (notifStyle === 'theme-grey') {
                    uiGroup.add_style_class_name('qpatcher-notification-theme');
                } else {
                    uiGroup.remove_style_class_name('qpatcher-notification-theme');
                }

                if (badgeAccent) {
                    uiGroup.add_style_class_name('qpatcher-badge-accent');
                } else {
                    uiGroup.remove_style_class_name('qpatcher-badge-accent');
                }
            }

            const cssPath = GLib.build_filenamev([this.path, 'qpatcher-dynamic.css']);
            const cssContent = `
                #panel.qpatcher-topbar-theme,
                #panelBox #panel.qpatcher-topbar-theme {
                    background-color: ${this._hexToRgba(themeColor, topbarOpacity)} !important;
                }

                .notification-banner,
                .message-banner,
                .message-list .message,
                .unlock-dialog-notifications-container .message {
                    background-color: ${this._hexToRgba(themeColor, notifOpacity)} !important;
                }

                .qpatcher-badge-accent .notification-badge,
                .qpatcher-badge-accent #dashtodockContainer .notification-badge,
                .qpatcher-badge-accent .app-well-app .notification-badge,
                .qpatcher-badge-accent .overview-tile .notification-badge,
                .qpatcher-badge-accent .icon-grid .notification-badge {
                    background-color: ${accentHex} !important;
                    color: #ffffff !important;
                }

                .qpatcher-hide-dock-notification-badge .notification-badge,
                .qpatcher-hide-dock-notification-badge #dashtodockContainer .notification-badge,
                .qpatcher-hide-dock-notification-badge .app-well-app .notification-badge,
                .qpatcher-hide-dock-notification-badge .overview-tile .notification-badge,
                .qpatcher-hide-dock-notification-badge .icon-grid .notification-badge {
                    opacity: 0 !important;
                    font-size: 0px !important;
                    min-width: 0px !important;
                    min-height: 0px !important;
                    max-width: 0px !important;
                    max-height: 0px !important;
                    width: 0px !important;
                    height: 0px !important;
                    border-width: 0px !important;
                    margin: 0px !important;
                    padding: 0px !important;
                    color: transparent !important;
                    background-color: transparent !important;
                    border-color: transparent !important;
                    box-shadow: none !important;
                    text-shadow: none !important;
                }

                .app-menu,
                .popup-menu.app-menu,
                .popup-menu,
                .popup-menu-boxpointer {
                    background-color: transparent !important;
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                }

                .qpatcher-recolor-menus .popup-menu-content,
                .qpatcher-recolor-menus .candidate-popup-content,
                .qpatcher-recolor-menus .app-menu .popup-menu-content,
                .qpatcher-recolor-menus .modal-dialog,
                .qpatcher-recolor-menus .quick-toggle-menu {
                    background-color: ${themeColor} !important;
                    border: 1px solid rgba(255, 255, 255, 0.12) !important;
                }

                /* Popup Menu Items Hover, Selected and Active */
                .popup-menu-item,
                .popup-sub-menu .popup-menu-item,
                .quick-toggle-menu .popup-menu-item,
                .candidate-popup-content .popup-menu-item {
                    transition-duration: 120ms !important;
                }

                .qpatcher-recolor-menus .popup-menu-item:hover,
                .qpatcher-recolor-menus .popup-menu-item:selected,
                .qpatcher-recolor-menus .popup-menu-item:focus,
                .qpatcher-menus-theme .popup-menu-item:hover,
                .qpatcher-menus-theme .popup-menu-item:selected,
                .qpatcher-menus-theme .popup-menu-item:focus,
                .popup-menu-content .popup-menu-item:hover,
                .popup-menu-content .popup-menu-item:selected,
                .popup-menu-content .popup-menu-item:focus,
                .popup-sub-menu .popup-menu-item:hover,
                .popup-sub-menu .popup-menu-item:selected,
                .popup-sub-menu .popup-menu-item:focus,
                .quick-toggle-menu .popup-menu-item:hover,
                .quick-toggle-menu .popup-menu-item:selected,
                .quick-toggle-menu .popup-menu-item:focus {
                    background-color: ${cardHoverBg} !important;
                    color: #ffffff !important;
                }

                .qpatcher-recolor-menus .popup-menu-item:active,
                .qpatcher-menus-theme .popup-menu-item:active,
                .popup-menu-content .popup-menu-item:active,
                .popup-sub-menu .popup-menu-item:active,
                .quick-toggle-menu .popup-menu-item:active {
                    background-color: ${cardActiveBg} !important;
                    color: #ffffff !important;
                }

                /* ======================================================== */
                /* INNER PODLOZHKI (CARDS, BUTTONS, TOGGLES, HEADERS)      */
                /* ======================================================== */

                /* Quick Settings Toggles */
                .quick-settings-system-item .power-item,
                .quick-settings-system-item .quick-toggle.power-item {
                    display: none !important;
                    width: 0px !important;
                    height: 0px !important;
                    min-width: 0px !important;
                    min-height: 0px !important;
                    max-width: 0px !important;
                    max-height: 0px !important;
                    margin: 0px !important;
                    padding: 0px !important;
                    border: none !important;
                    background-color: transparent !important;
                    background: transparent !important;
                    box-shadow: none !important;
                    opacity: 0 !important;
                }

                .qpatcher-recolor-menus .quick-toggle:not(.power-item),
                .qpatcher-menus-theme .quick-toggle:not(.power-item),
                .qpatcher-qs-theme .quick-toggle:not(.power-item),
                .quick-settings .quick-toggle:not(.power-item) {
                    background-color: ${cardBg} !important;
                }

                .qpatcher-recolor-menus .quick-toggle:not(.power-item):hover,
                .qpatcher-menus-theme .quick-toggle:not(.power-item):hover,
                .qpatcher-qs-theme .quick-toggle:not(.power-item):hover,
                .quick-settings .quick-toggle:not(.power-item):hover {
                    background-color: ${cardHoverBg} !important;
                }

                .qpatcher-recolor-menus .quick-toggle:not(.power-item):active,
                .qpatcher-menus-theme .quick-toggle:not(.power-item):active,
                .qpatcher-qs-theme .quick-toggle:not(.power-item):active,
                .quick-settings .quick-toggle:not(.power-item):active {
                    background-color: ${cardActiveBg} !important;
                }

                .qpatcher-recolor-menus .quick-toggle:checked,
                .qpatcher-menus-theme .quick-toggle:checked,
                .qpatcher-qs-theme .quick-toggle:checked,
                .quick-toggle:checked {
                    background-color: ${accentHex} !important;
                    color: #ffffff !important;
                }

                .qpatcher-recolor-menus .quick-toggle-has-menu .quick-toggle-menu-button,
                .qpatcher-menus-theme .quick-toggle-has-menu .quick-toggle-menu-button,
                .qpatcher-qs-theme .quick-toggle-has-menu .quick-toggle-menu-button,
                .quick-toggle-has-menu .quick-toggle-menu-button {
                    background-color: ${cardHoverBg} !important;
                }

                /* Quick Settings Header Round Buttons */
                .quick-settings .icon-button,
                .quick-settings-system-item .icon-button,
                .quick-settings-system-item > StButton,
                .qpatcher-recolor-menus .quick-settings .icon-button,
                .qpatcher-recolor-menus .quick-settings-system-item .icon-button,
                .qpatcher-menus-theme .quick-settings .icon-button,
                .qpatcher-menus-theme .quick-settings-system-item .icon-button,
                .qpatcher-qs-theme .quick-settings .icon-button,
                .qpatcher-qs-theme .quick-settings-system-item .icon-button {
                    background-color: ${cardBg} !important;
                }

                .quick-settings .icon-button:hover,
                .quick-settings-system-item .icon-button:hover,
                .quick-settings-system-item > StButton:hover,
                .qpatcher-recolor-menus .quick-settings .icon-button:hover,
                .qpatcher-recolor-menus .quick-settings-system-item .icon-button:hover,
                .qpatcher-menus-theme .quick-settings .icon-button:hover,
                .qpatcher-menus-theme .quick-settings-system-item .icon-button:hover,
                .qpatcher-qs-theme .quick-settings .icon-button:hover,
                .qpatcher-qs-theme .quick-settings-system-item .icon-button:hover {
                    background-color: ${cardHoverBg} !important;
                }

                /* Quick Sliders */
                .quick-settings .slider,
                .qpatcher-menus-theme .slider,
                .qpatcher-recolor-menus .slider,
                .qpatcher-qs-theme .slider {
                    background-color: ${sliderTroughBg} !important;
                    -barlevel-active-background-color: ${accentHex} !important;
                }

                /* Calendar Days, Weekdays, Week Numbers - Transparent by Default */
                .calendar .calendar-day,
                .calendar .calendar-day-base,
                .calendar .calendar-day-heading,
                .calendar .calendar-week-number,
                .qpatcher-datemenu-theme .calendar .calendar-day,
                .qpatcher-datemenu-theme .calendar .calendar-day-base,
                .qpatcher-datemenu-theme .calendar .calendar-day-heading,
                .qpatcher-datemenu-theme .calendar .calendar-week-number,
                .qpatcher-menus-theme .calendar .calendar-day,
                .qpatcher-menus-theme .calendar .calendar-day-base,
                .qpatcher-menus-theme .calendar .calendar-day-heading,
                .qpatcher-menus-theme .calendar .calendar-week-number,
                .qpatcher-recolor-menus .calendar .calendar-day,
                .qpatcher-recolor-menus .calendar .calendar-day-base,
                .qpatcher-recolor-menus .calendar .calendar-day-heading,
                .qpatcher-recolor-menus .calendar .calendar-week-number {
                    background-color: transparent !important;
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                }

                /* Calendar Day Hover & Active */
                .calendar .calendar-day:hover,
                .calendar .calendar-day-base:hover,
                .qpatcher-datemenu-theme .calendar .calendar-day:hover,
                .qpatcher-datemenu-theme .calendar .calendar-day-base:hover,
                .qpatcher-menus-theme .calendar .calendar-day:hover,
                .qpatcher-menus-theme .calendar .calendar-day-base:hover,
                .qpatcher-recolor-menus .calendar .calendar-day:hover,
                .qpatcher-recolor-menus .calendar .calendar-day-base:hover {
                    background-color: ${cardHoverBg} !important;
                    border-radius: 999px !important;
                }

                .calendar .calendar-day:selected,
                .calendar .calendar-day:active,
                .calendar .calendar-day-base:selected,
                .calendar .calendar-day-base:active,
                .qpatcher-datemenu-theme .calendar .calendar-day:selected,
                .qpatcher-datemenu-theme .calendar .calendar-day:active,
                .qpatcher-datemenu-theme .calendar .calendar-day-base:selected,
                .qpatcher-datemenu-theme .calendar .calendar-day-base:active,
                .qpatcher-menus-theme .calendar .calendar-day:selected,
                .qpatcher-menus-theme .calendar .calendar-day:active,
                .qpatcher-menus-theme .calendar .calendar-day-base:selected,
                .qpatcher-menus-theme .calendar .calendar-day-base:active,
                .qpatcher-recolor-menus .calendar .calendar-day:selected,
                .qpatcher-recolor-menus .calendar .calendar-day:active,
                .qpatcher-recolor-menus .calendar .calendar-day-base:selected,
                .qpatcher-recolor-menus .calendar .calendar-day-base:active {
                    background-color: ${cardActiveBg} !important;
                    border-radius: 999px !important;
                }

                /* Today Accent Highlight */
                .calendar .calendar-day.calendar-today,
                .qpatcher-datemenu-theme .calendar .calendar-day.calendar-today,
                .qpatcher-menus-theme .calendar .calendar-day.calendar-today,
                .qpatcher-recolor-menus .calendar .calendar-day.calendar-today {
                    background-color: ${accentHex} !important;
                    color: #ffffff !important;
                    border-radius: 999px !important;
                }

                /* Calendar Month Header & Pagers */
                .calendar .calendar-month-header .calendar-month-label,
                .qpatcher-datemenu-theme .calendar .calendar-month-header .calendar-month-label,
                .qpatcher-menus-theme .calendar .calendar-month-header .calendar-month-label,
                .qpatcher-recolor-menus .calendar .calendar-month-header .calendar-month-label {
                    background-color: transparent !important;
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                }

                .calendar .calendar-month-header .pager-button,
                .qpatcher-datemenu-theme .calendar .calendar-month-header .pager-button,
                .qpatcher-menus-theme .calendar .calendar-month-header .pager-button,
                .qpatcher-recolor-menus .calendar .calendar-month-header .pager-button {
                    background-color: transparent !important;
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                    border-radius: 999px !important;
                }

                .calendar .calendar-month-header .pager-button:hover,
                .qpatcher-datemenu-theme .calendar .calendar-month-header .pager-button:hover,
                .qpatcher-menus-theme .calendar .calendar-month-header .pager-button:hover,
                .qpatcher-recolor-menus .calendar .calendar-month-header .pager-button:hover {
                    background-color: ${cardHoverBg} !important;
                }

                .calendar .calendar-month-header .pager-button:active,
                .qpatcher-datemenu-theme .calendar .calendar-month-header .pager-button:active,
                .qpatcher-menus-theme .calendar .calendar-month-header .pager-button:active,
                .qpatcher-recolor-menus .calendar .calendar-month-header .pager-button:active {
                    background-color: ${cardActiveBg} !important;
                }

                /* Today Button */
                .datemenu-today-button,
                .qpatcher-datemenu-theme .datemenu-today-button,
                .qpatcher-menus-theme .datemenu-today-button,
                .qpatcher-recolor-menus .datemenu-today-button {
                    background-color: transparent !important;
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                }

                .datemenu-today-button:hover,
                .qpatcher-datemenu-theme .datemenu-today-button:hover,
                .qpatcher-menus-theme .datemenu-today-button:hover,
                .qpatcher-recolor-menus .datemenu-today-button:hover {
                    background-color: ${cardHoverBg} !important;
                    border-radius: 12px !important;
                }

                /* World Clocks, Weather, Events Buttons */
                .world-clocks-button,
                .weather-button,
                .events-button,
                .qpatcher-menus-theme .world-clocks-button,
                .qpatcher-menus-theme .weather-button,
                .qpatcher-menus-theme .events-button,
                .qpatcher-recolor-menus .world-clocks-button,
                .qpatcher-recolor-menus .weather-button,
                .qpatcher-recolor-menus .events-button,
                .qpatcher-datemenu-theme .world-clocks-button,
                .qpatcher-datemenu-theme .weather-button,
                .qpatcher-datemenu-theme .events-button {
                    background-color: ${cardBg} !important;
                }

                .world-clocks-button:hover,
                .weather-button:hover,
                .events-button:hover,
                .qpatcher-menus-theme .world-clocks-button:hover,
                .qpatcher-menus-theme .weather-button:hover,
                .qpatcher-menus-theme .events-button:hover,
                .qpatcher-recolor-menus .world-clocks-button:hover,
                .qpatcher-recolor-menus .weather-button:hover,
                .qpatcher-recolor-menus .events-button:hover,
                .qpatcher-datemenu-theme .world-clocks-button:hover,
                .qpatcher-datemenu-theme .weather-button:hover,
                .qpatcher-datemenu-theme .events-button:hover {
                    background-color: ${cardHoverBg} !important;
                }

                /* Clear all notifications button */
                .message-list-clear-button,
                .qpatcher-menus-theme .message-list-clear-button,
                .qpatcher-recolor-menus .message-list-clear-button,
                .qpatcher-datemenu-theme .message-list-clear-button {
                    background-color: ${cardBg} !important;
                    color: #ffffff !important;
                }

                .message-list-clear-button:hover,
                .qpatcher-menus-theme .message-list-clear-button:hover,
                .qpatcher-recolor-menus .message-list-clear-button:hover,
                .qpatcher-datemenu-theme .message-list-clear-button:hover {
                    background-color: ${cardHoverBg} !important;
                    color: #ffffff !important;
                }

                .message-list-clear-button:active,
                .qpatcher-menus-theme .message-list-clear-button:active,
                .qpatcher-recolor-menus .message-list-clear-button:active,
                .qpatcher-datemenu-theme .message-list-clear-button:active {
                    background-color: ${cardActiveBg} !important;
                }

                /* Notification cards inside DateMenu */
                .qpatcher-datemenu-theme .message-list .message,
                .qpatcher-menus-theme .message-list .message,
                .qpatcher-recolor-menus .message-list .message {
                    background-color: ${cardBg} !important;
                }

                .qpatcher-datemenu-theme .message-list .message:hover,
                .qpatcher-menus-theme .message-list .message:hover,
                .qpatcher-recolor-menus .message-list .message:hover {
                    background-color: ${cardHoverBg} !important;
                }

                /* General buttons in themed dialogs and menus */
                .qpatcher-recolor-menus .modal-dialog .button,
                .qpatcher-menus-theme .modal-dialog .button {
                    background-color: ${cardBg} !important;
                }

                .qpatcher-recolor-menus .modal-dialog .button:hover,
                .qpatcher-menus-theme .modal-dialog .button:hover {
                    background-color: ${cardHoverBg} !important;
                }

                .qpatcher-recolor-menus .modal-dialog .button:active,
                .qpatcher-menus-theme .modal-dialog .button:active {
                    background-color: ${cardActiveBg} !important;
                }

                .qpatcher-recolor-menus .modal-dialog .button.default,
                .qpatcher-menus-theme .modal-dialog .button.default {
                    background-color: ${accentHex} !important;
                    color: #ffffff !important;
                }

                /* Submenus in Quick Settings */
                .quick-toggle-menu,
                .qpatcher-recolor-menus .quick-toggle-menu,
                .qpatcher-menus-theme .quick-toggle-menu,
                .qpatcher-qs-theme .quick-toggle-menu {
                    background-color: ${cardBg} !important;
                    border: 1px solid rgba(255, 255, 255, 0.12) !important;
                }
            `;
            GLib.file_set_contents(cssPath, cssContent);

            const theme = St.ThemeContext.get_for_stage(global.stage)?.get_theme();
            if (theme) {
                const file = Gio.File.new_for_path(cssPath);
                if (this._dynamicStylesheetLoaded) {
                    try { theme.unload_stylesheet(file); } catch (e) {}
                }
                try {
                    theme.load_stylesheet(file);
                    this._dynamicStylesheetLoaded = true;
                } catch (e) {}
            }
        } catch (e) {}
    }

    _updateOverviewSearchVisibility() {
        try {
            const hideSetting = this._getSettingBool('overview-search-hide');
            const controls = Main.overview?._overview?._controls;
            const searchController = controls?._searchController;
            const searchEntry = controls?._searchEntry || Main.overview?.searchEntry;
            const searchEntryBin = controls?._searchEntryBin;

            const text = searchEntry?.clutter_text?.text || '';
            const isSearching = (searchController && searchController.searchActive) || text.length > 0;

            const uiGroup = this._getUiGroup();
            if (uiGroup) {
                if (hideSetting && !isSearching) {
                    uiGroup.add_style_class_name('qpatcher-no-overview-search');
                } else {
                    uiGroup.remove_style_class_name('qpatcher-no-overview-search');
                }
            }

            if (searchEntry) {
                searchEntry.visible = true;
            }
            if (searchEntryBin) {
                searchEntryBin.visible = true;
            }
        } catch (e) {
            console.warn('[QPatcher] Error updating overview search visibility:', e);
        }
    }

    _setupOverviewSearchHooks() {
        try {
            const controls = Main.overview?._overview?._controls;
            const searchController = controls?._searchController;
            const searchEntry = controls?._searchEntry || Main.overview?.searchEntry;

            if (searchController && !searchController._qpatcherSearchActiveHooked) {
                searchController._qpatcherSearchActiveHooked = true;
                const id = searchController.connect('notify::search-active', () => {
                    this._updateOverviewSearchVisibility();
                });
                this._signals.push({ obj: searchController, id });
            }

            if (searchEntry?.clutter_text && !searchEntry.clutter_text._qpatcherTextHooked) {
                searchEntry.clutter_text._qpatcherTextHooked = true;
                const id = searchEntry.clutter_text.connect('text-changed', () => {
                    this._updateOverviewSearchVisibility();
                });
                this._signals.push({ obj: searchEntry.clutter_text, id });
            }

            if (Main.overview && !Main.overview._qpatcherSearchOverviewHooked) {
                Main.overview._qpatcherSearchOverviewHooked = true;
                const id1 = Main.overview.connect('showing', () => {
                    this._setupOverviewSearchHooks();
                    this._updateOverviewSearchVisibility();
                });
                const id2 = Main.overview.connect('hidden', () => {
                    this._updateOverviewSearchVisibility();
                });
                this._signals.push({ obj: Main.overview, id: id1 });
                this._signals.push({ obj: Main.overview, id: id2 });
            }
        } catch (e) {
            console.warn('[QPatcher] Error setting up overview search hooks:', e);
        }
    }

    _setupOverviewBlur() {
        this._destroyOverviewBlur();
        const uiGroup = this._getUiGroup();
        if (uiGroup) {
            uiGroup.remove_style_class_name('qpatcher-overview-blur-active');
        }
    }

    _destroyOverviewBlur() {
        try {
            if (this._overviewChildAddedId && Main.layoutManager?.overviewGroup) {
                Main.layoutManager.overviewGroup.disconnect(this._overviewChildAddedId);
                this._overviewChildAddedId = 0;
            }
            this._reorderingOverview = false;
            if (this._overviewBackgroundManagers) {
                this._overviewBackgroundManagers.forEach(mgr => {
                    if (mgr?.destroy) mgr.destroy();
                });
                this._overviewBackgroundManagers = [];
            }
            if (this._overviewBackgroundGroup) {
                if (this._overviewBackgroundGroup.get_parent()) {
                    this._overviewBackgroundGroup.get_parent().remove_child(this._overviewBackgroundGroup);
                }
                this._overviewBackgroundGroup.destroy();
                this._overviewBackgroundGroup = null;
            }
        } catch (e) {}
    }

    _updateDateMenuStyle() {
        try {
            const style = this._getSettingString('datemenu-style', 'default');
            const opacity = this._getSettingInt('datemenu-opacity', 100) / 100.0;
            const color = this._getSettingString('theme-color', '#232326');
            const dateMenu = Main.panel?.statusArea?.dateMenu;
            const menuBox = dateMenu?.menu?.box;
            if (!menuBox) return;

            menuBox.remove_style_class_name('qpatcher-datemenu-theme');

            if (style === 'theme-grey') {
                menuBox.add_style_class_name('qpatcher-datemenu-theme');
                menuBox.set_style(`background-color: ${this._hexToRgba(color, opacity)} !important;`);
            } else {
                menuBox.set_style(null);
            }

            if (dateMenu.menu && !dateMenu.menu._qpatcherStyleHooked) {
                dateMenu.menu._qpatcherStyleHooked = true;
                dateMenu.menu.connect('open-state-changed', (menu, isOpen) => {
                    if (isOpen) this._updateDateMenuStyle();
                });
            }
        } catch (e) {}
    }

    _updateQuickSettingsStyle() {
        try {
            const style = this._getSettingString('quicksettings-style', 'default');
            const opacity = this._getSettingInt('quicksettings-opacity', 100) / 100.0;
            const color = this._getSettingString('theme-color', '#232326');
            const qs = Main.panel?.statusArea?.quickSettings;
            const menuBox = qs?.menu?.box;
            if (!menuBox) return;

            menuBox.remove_style_class_name('qpatcher-qs-theme');

            if (style === 'theme-grey') {
                menuBox.add_style_class_name('qpatcher-qs-theme');
                menuBox.set_style(`background-color: ${this._hexToRgba(color, opacity)} !important;`);
            } else {
                menuBox.set_style(null);
            }

            if (qs.menu && !qs.menu._qpatcherStyleHooked) {
                qs.menu._qpatcherStyleHooked = true;
                qs.menu.connect('open-state-changed', (menu, isOpen) => {
                    if (isOpen) this._updateQuickSettingsStyle();
                });
            }
        } catch (e) {}
    }

    _updateNotificationStyle() {
        try {
            const style = this._getSettingString('notification-style', 'theme-grey');
            const opacity = this._getSettingInt('notification-opacity', 100) / 100.0;
            const themeColor = this._getSettingString('theme-color', '#232326');

            if (Main.messageTray && !this._messageTrayHooked) {
                this._messageTrayHooked = true;
                const origShow = Main.messageTray._showNotification;
                if (origShow) {
                    const self = this;
                    Main.messageTray._showNotification = function() {
                        self._updateNotificationPosition();
                        const res = origShow.apply(this, arguments);
                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            self._updateNotificationStyle();
                            self._updateNotificationPosition();
                            return GLib.SOURCE_REMOVE;
                        });
                        return res;
                    };
                }
            }

            const banners = [];
            if (Main.messageTray?._banner) banners.push(Main.messageTray._banner);
            if (Main.messageTray?._bannerBin?.get_children) {
                for (const c of Main.messageTray._bannerBin.get_children()) {
                    if (c && !banners.includes(c)) banners.push(c);
                }
            }

            for (const banner of banners) {
                banner.remove_style_class_name('qpatcher-notification-theme');

                if (style === 'theme-grey') {
                    banner.add_style_class_name('qpatcher-notification-theme');
                    banner.set_style(`background-color: ${this._hexToRgba(themeColor, opacity)} !important;`);
                } else {
                    banner.set_style(null);
                }
            }
        } catch (e) {}
    }

    _syncDashToDockSettings() {
        try {
            const visibleOnDesktop = this._getSettingBool('dock-always-visible');
            const intellihide = this._getSettingBool('dock-intellihide');
            const hideTooltips = this._getSettingBool('dock-tooltips-hide');
            const hideBadges = this._getSettingBool('dock-notification-badge-hide');
            const hideShowApps = this._getSettingBool('dock-show-apps-hide');
            const showMounts = this._getSettingBool('dock-show-mounts');
            const showTrash = this._getSettingBool('dock-show-trash');
            const runningBar = this._getSettingBool('dock-running-indicator-bar');
            const hideDots = this._getSettingBool('dock-running-dots-hide');
            const iconSize = this._getSettingInt('dock-icon-size', 48);
            const style = this._getSettingString('dock-style', 'theme-grey');
            const opacity = this._getSettingInt('dock-opacity', 100) / 100.0;
            const themeColor = this._getSettingString('theme-color', '#232326');
            const accentColor = this._getAccentHex();

            if (visibleOnDesktop) {
                if (!this._dockManager) {
                    try {
                        this._dockManager = new DockManager(this._dockAdapter);
                        if (this._dockManager) {
                            const docksReadyId = this._dockManager.connect('docks-ready', () => {
                                this._setupDockMagnification();
                            });
                            this._signals.push({ obj: this._dockManager, id: docksReadyId });
                        }
                    } catch (e) {
                        console.error('[QPatcher] Error initializing DockManager:', e);
                    }
                }
            } else {
                if (this._dockManager) {
                    try {
                        this._dockManager.destroy();
                    } catch (e) {
                        console.error('[QPatcher] Error destroying DockManager:', e);
                    }
                    this._dockManager = null;
                }
            }

            const d2d = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dash-to-dock' });
            if (visibleOnDesktop) {
                if (intellihide) {
                    d2d.set_boolean('dock-fixed', false);
                    d2d.set_boolean('intellihide', true);
                    d2d.set_boolean('autohide', false);
                    d2d.set_string('intellihide-mode', 'FOCUS_APPLICATION_WINDOWS');
                } else {
                    d2d.set_boolean('dock-fixed', true);
                    d2d.set_boolean('intellihide', false);
                    d2d.set_boolean('autohide', false);
                }
            }
            d2d.set_boolean('show-mounts', showMounts);
            d2d.set_boolean('show-mounts-only-mounted', false);
            d2d.set_boolean('show-trash', showTrash);
            d2d.set_boolean('hide-tooltip', hideTooltips);
            d2d.set_boolean('show-icons-notifications-counter', !hideBadges);
            d2d.set_boolean('show-show-apps-button', !hideShowApps);
            d2d.set_int('dash-max-icon-size', iconSize);
            d2d.set_boolean('custom-theme-shrink', true);
            d2d.set_string('transparency-mode', 'FIXED');

            // Индикаторы активности запущенных приложений (одиночная полоска или точки)
            if (runningBar) {
                d2d.set_string('running-indicator-style', 'SOLID');
                d2d.set_boolean('custom-theme-customize-running-dots', true);
                d2d.set_string('custom-theme-running-dots-color', accentColor);
                d2d.set_string('custom-theme-running-dots-border-color', accentColor);
                d2d.set_int('custom-theme-running-dots-border-width', 0);
            } else if (hideDots) {
                d2d.set_string('running-indicator-style', 'DEFAULT');
                d2d.set_boolean('custom-theme-customize-running-dots', false);
            } else {
                d2d.set_string('running-indicator-style', 'DOTS');
                d2d.set_boolean('custom-theme-customize-running-dots', false);
            }

            if (style === 'theme-grey') {
                d2d.set_boolean('apply-custom-theme', true);
                d2d.set_boolean('custom-background-color', true);
                d2d.set_string('background-color', themeColor);
                d2d.set_double('background-opacity', opacity);
            } else {
                d2d.set_boolean('apply-custom-theme', true);
                d2d.set_boolean('custom-background-color', false);
                d2d.set_double('background-opacity', opacity);
            }

            // Синхронизация монитора для дока
            const dockMonSetting = this._getSettingInt('dock-monitor', 0);
            if (dockMonSetting === 3) {
                // Отображать на всех мониторах
                d2d.set_boolean('multi-monitor', true);
            } else {
                d2d.set_boolean('multi-monitor', false);
                let targetMonIndex;
                if (dockMonSetting === 0) {
                    // Следовать за верхней панелью
                    targetMonIndex = this._getTargetTopbarMonitorIndex();
                } else {
                    const rawIdx = dockMonSetting - 1;
                    const monitors = Main.layoutManager?.monitors || [];
                    targetMonIndex = (rawIdx >= 0 && rawIdx < monitors.length) ? rawIdx : 0;
                }

                const monitors = Main.layoutManager?.monitors || [];
                if (targetMonIndex >= 0 && targetMonIndex < monitors.length) {
                    const mon = monitors[targetMonIndex];
                    if (mon && mon.connector) {
                        d2d.set_int('preferred-monitor', -2);
                        d2d.set_string('preferred-monitor-by-connector', mon.connector);
                    } else {
                        d2d.set_int('preferred-monitor', targetMonIndex);
                    }
                }
            }

            this._updateDockNotificationBadgesVisibility();
        } catch (e) {}
    }

    _updateDockNotificationBadgesVisibility() {
        try {
            const hide = this._getSettingBool('dock-notification-badge-hide');
            const allDocks = DockManager?.allDocks || this._dockManager?._allDocks || [];
            allDocks.forEach(dock => {
                const dash = dock?.dash;
                if (dash?._box) {
                    dash._box.get_children().forEach(item => {
                        const icon = item?.child;
                        if (icon?._indicator?._indicators) {
                            icon._indicator._indicators.forEach(ind => {
                                if (hide && ind._notificationBadgeBin) {
                                    ind._notificationBadgeBin.destroy();
                                    ind._notificationBadgeBin = null;
                                }
                                if (typeof ind._updateNotificationsCount === 'function') {
                                    ind._updateNotificationsCount();
                                }
                            });
                        }
                        if (icon?._iconContainer) {
                            icon._iconContainer.get_children().forEach(c => {
                                if (c?.has_style_class_name?.('notification-badge') ||
                                    c?.child?.has_style_class_name?.('notification-badge')) {
                                    if (hide) {
                                        c.visible = false;
                                        c.opacity = 0;
                                        c.destroy();
                                    } else {
                                        c.visible = true;
                                        c.opacity = 255;
                                    }
                                }
                            });
                        }
                    });
                }
            });
        } catch (e) {}
    }

    _getAllDashes() {
        const dashes = new Set();
        if (Main.overview?.dash) dashes.add(Main.overview.dash);
        if (Main.overview?._overview?._controls?._dash) dashes.add(Main.overview._overview._controls._dash);

        // 1. Из DockManager
        if (this._dockManager?._allDocks) {
            for (const dock of this._dockManager._allDocks) {
                if (dock?.dash) dashes.add(dock.dash);
            }
        }

        // 2. Из Main.uiGroup и global.stage
        const searchContainer = (parent) => {
            if (!parent?.get_children) return;
            for (const child of parent.get_children()) {
                if (!child) continue;
                if (child.name === 'dashtodockContainer' || (child.has_style_class_name && child.has_style_class_name('dashtodockContainer'))) {
                    if (child.dash) dashes.add(child.dash);
                    const slider = child._slider || child.get_children?.()[0];
                    const content = slider?.get_child?.() || slider;
                    if (content?.get_children) {
                        for (const c of content.get_children()) {
                            if (c.name === 'dash' || (c.has_style_class_name && c.has_style_class_name('dash')) || c.dash) {
                                dashes.add(c.dash || c);
                            }
                        }
                    }
                }
            }
        };

        if (Main.uiGroup) searchContainer(Main.uiGroup);
        if (global.stage) searchContainer(global.stage);

        return Array.from(dashes);
    }

    _hookDockIcon(icon) {
        if (!icon) return;
        if (icon.clip_to_allocation !== undefined) icon.clip_to_allocation = false;
        icon.set_pivot_point(0.5, 0.5);

        if (!icon._qpatcherConnected) {
            icon._qpatcherConnected = true;

            icon.connect('notify::hover', () => {
                if (!this._getSettingBool('dock-magnification')) return;
                if (icon.hover) {
                    icon.ease({
                        scale_x: 1.15,
                        scale_y: 1.15,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                } else {
                    icon.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 140,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            });

            icon.connect('button-press-event', () => {
                if (!this._getSettingBool('dock-magnification')) return Clutter.EVENT_PROPAGATE;
                icon.ease({
                    scale_x: 0.95,
                    scale_y: 0.95,
                    duration: 80,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        icon.ease({
                            scale_x: icon.hover ? 1.15 : 1.0,
                            scale_y: icon.hover ? 1.15 : 1.0,
                            duration: 120,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    }
                });
                return Clutter.EVENT_PROPAGATE;
            });
        }
    }

    _hookDockItem(item) {
        if (!item) return;
        if (item.clip_to_allocation !== undefined) item.clip_to_allocation = false;

        const icon = item.child || item;
        this._hookDockIcon(icon);

        if (icon?.toggleButton) {
            this._hookDockIcon(icon.toggleButton);
        }
    }

    _setupDashMagnification(dash) {
        if (!dash) return;

        // Отключаем обрезку по всей цепочке родителей
        let curr = dash;
        while (curr && curr !== global.stage && curr !== Main.uiGroup) {
            if (curr.clip_to_allocation !== undefined) curr.clip_to_allocation = false;
            curr = curr.get_parent?.();
        }

        if (dash.clip_to_allocation !== undefined) dash.clip_to_allocation = false;
        if (dash._dashContainer) dash._dashContainer.clip_to_allocation = false;
        if (dash._scrollView) dash._scrollView.clip_to_allocation = false;
        if (dash._boxContainer) dash._boxContainer.clip_to_allocation = false;

        const box = dash._box || dash;
        if (box) {
            if (box.clip_to_allocation !== undefined) box.clip_to_allocation = false;

            if (!box._qpatcherChildAddedHooked) {
                box._qpatcherChildAddedHooked = true;
                box.connect('child-added', (_, item) => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._hookDockItem(item);
                        return GLib.SOURCE_REMOVE;
                    });
                });
            }

            if (box.get_children) {
                for (const item of box.get_children()) {
                    this._hookDockItem(item);
                }
            }
        }

        if (dash._redisplay && !dash._qpatcherRedisplayHooked) {
            dash._qpatcherRedisplayHooked = true;
            const origRedisplay = dash._redisplay.bind(dash);
            dash._redisplay = () => {
                origRedisplay();
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._setupDashMagnification(dash);
                    return GLib.SOURCE_REMOVE;
                });
            };
        }

        if (dash._showAppsIcon) {
            this._hookDockItem(dash._showAppsIcon);
            if (dash.showAppsButton) {
                this._hookDockItem(dash.showAppsButton);
            }
        }
    }

    _setupDockMagnification() {
        try {
            const dashes = this._getAllDashes();
            for (const dash of dashes) {
                this._setupDashMagnification(dash);
            }
        } catch (e) {
            console.error('[QPatcher] Error in _setupDockMagnification:', e);
        }
    }

    _applyQuickSettingsFullWidth() {
        try {
            const qs = Main.panel?.statusArea?.quickSettings;
            const grid = qs?.menu?._grid;
            if (!grid) return;

            // Надежно держим хук на открытие меню и добавление дочерних плиток
            if (qs.menu && !qs.menu._qpatcherOpenStateConnected) {
                qs.menu._qpatcherOpenStateConnected = true;
                qs.menu.connect('open-state-changed', (menu, isOpen) => {
                    if (isOpen) {
                        this._applyQuickSettingsFullWidth();
                    }
                });
            }

            if (!grid._qpatcherChildAddedConnected) {
                grid._qpatcherChildAddedConnected = true;
                const reapply = () => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._applyQuickSettingsFullWidth();
                        return GLib.SOURCE_REMOVE;
                    });
                };
                grid.connect('actor-added', reapply);
                grid.connect('actor-removed', reapply);
            }

            const enabled = this._getSettingBool('quicksettings-full-width-toggle');
            const bgAppsFullWidth = this._getSettingBool('quicksettings-background-apps-full-width', false);
            const layout = grid.layout_manager;
            if (!layout) return;

            const setSpan = (child, span) => {
                if (layout.child_set_property) {
                    try {
                        layout.child_set_property(grid, child, 'column-span', span);
                    } catch (e) {}
                }
                const meta = layout.get_child_meta ? layout.get_child_meta(grid, child) : null;
                if (meta) {
                    meta.columnSpan = span;
                    meta.column_span = span;
                }
            };

            const toggles = [];
            for (const child of grid) {
                if (!child.visible) continue;
                const isBgApps = child.has_style_class_name?.('background-apps-quick-toggle') ||
                                 child.constructor?.name === 'BackgroundAppsToggle';
                if (isBgApps) {
                    if (bgAppsFullWidth) {
                        setSpan(child, 2);
                        continue;
                    } else {
                        setSpan(child, 1);
                    }
                }
                const isToggle = child.has_style_class_name?.('quick-toggle') ||
                                 child.has_style_class_name?.('quick-toggle-has-menu') ||
                                 child.constructor?.name?.endsWith('Toggle');
                const isSlider = child.has_style_class_name?.('quick-slider') ||
                                 child.constructor?.name?.endsWith('Slider');
                if (isToggle && !isSlider) {
                    toggles.push(child);
                }
            }

            const shouldExpandLast = enabled && (toggles.length % 2 !== 0);
            for (let i = 0; i < toggles.length; i++) {
                const toggle = toggles[i];
                const span = (shouldExpandLast && i === toggles.length - 1) ? 2 : 1;
                setSpan(toggle, span);
            }
            layout.layout_changed?.();
            grid.queue_relayout();
        } catch (e) {}
    }

    _getTargetTopbarMonitorIndex() {
        const raw = this._getSettingInt('topbar-monitor');
        const primaryIndex = Main.layoutManager?.primaryIndex ?? 0;
        const monitors = Main.layoutManager?.monitors || [];
        if (monitors.length === 0) return 0;

        if (raw === 0) {
            return (primaryIndex >= 0 && primaryIndex < monitors.length) ? primaryIndex : 0;
        }

        const specificIndex = raw - 1;
        if (specificIndex >= 0 && specificIndex < monitors.length) {
            return specificIndex;
        }
        return (primaryIndex >= 0 && primaryIndex < monitors.length) ? primaryIndex : 0;
    }

    _updatePanelMonitor() {
        try {
            if (Main.sessionMode?.currentMode === 'unlock-dialog' && !this._getSettingBool('lockscreen-topbar-enable', true)) {
                return;
            }
            const targetMonitor = this._getTargetTopbarMonitorIndex();
            const panelBox = Main.layoutManager?.panelBox;
            if (!panelBox) return;

            const monitors = Main.layoutManager?.monitors || [];
            if (targetMonitor >= 0 && targetMonitor < monitors.length) {
                const mon = monitors[targetMonitor];
                panelBox.set_position(mon.x, mon.y);
                panelBox.set_size(mon.width, panelBox.height);

                // Поднимаем панель над всеми слоями окон, чтобы окна никогда её не перекрывали
                const uiGroup = this._getUiGroup();
                if (uiGroup) {
                    uiGroup.set_child_above_sibling(panelBox, null);
                }

                if (Array.isArray(Main.layoutManager._trackedActors)) {
                    for (const item of Main.layoutManager._trackedActors) {
                        if (item.actor === panelBox) {
                            item.affectsStruts = true;
                            if (this._getSettingBool('topbar-show-in-fullscreen', false)) {
                                item.trackFullscreen = false;
                            }
                            break;
                        }
                    }
                }

                Main.layoutManager._queueUpdateRegions();
            }
        } catch (e) {
            console.error('[QPatcher] Error updating panel monitor:', e);
        }
    }

    _setupWindowConstraints() {
        try {
            if (!this._windowConstraint) {
                this._windowConstraint = new TopBarWindowConstraint(this);
            }

            const applyToWindow = (win) => {
                if (!win || win.is_override_redirect?.()) return;
                try {
                    win.add_external_constraint(this._windowConstraint);
                } catch (e) {}
            };

            const display = global.display;
            if (display && !this._windowConstraintConnected) {
                this._windowConstraintConnected = true;
                const id = display.connect('window-created', (d, win) => {
                    applyToWindow(win);
                });
                this._signals.push({ obj: display, id });

                if (display.get_tab_list) {
                    const windows = display.get_tab_list(Meta.TabList.NORMAL_ALL, null) || [];
                    windows.forEach(applyToWindow);
                }
            }
        } catch (e) {
            console.error('[QPatcher] Error setting up window constraints:', e);
        }
    }

    _removeWindowConstraints() {
        try {
            if (!this._windowConstraint) return;
            const display = global.display;
            if (display?.get_tab_list) {
                const windows = display.get_tab_list(Meta.TabList.NORMAL_ALL, null) || [];
                for (const win of windows) {
                    try {
                        win.remove_external_constraint(this._windowConstraint);
                    } catch (e) {}
                }
            }
            this._windowConstraint = null;
            this._windowConstraintConnected = false;
        } catch (e) {}
    }

    _updateNotificationPosition() {
        try {
            const tray = Main.messageTray;
            if (!tray || !tray._bannerBin) return;

            const targetMonitor = this._getSettingInt('notification-monitor');
            const hAlign = this._getSettingString('notification-horizontal-alignment', 'center');

            // 1. Позиционирование на мониторе
            const maxMonIndex = Math.max(0, (Main.layoutManager?.monitors?.length ?? 1) - 1);
            const isPrimary = targetMonitor === 0;
            const monIndex = isPrimary
                ? (Main.layoutManager.primaryIndex ?? 0)
                : Math.min(Math.max(0, targetMonitor - 1), maxMonIndex);

            const constraints = tray.get_constraints ? (tray.get_constraints() || []) : [];
            for (const c of constraints) {
                if (c && 'index' in c) {
                    c.index = monIndex;
                }
                if (c && 'primary' in c) {
                    c.primary = isPrimary;
                }
            }

            // 2. Горизонтальное выравнивание
            tray.x_expand = true;
            tray._bannerBin.x_expand = true;
            tray._bannerBin.margin_left = 0;
            tray._bannerBin.margin_right = 0;

            const banners = [];
            if (tray._banner) banners.push(tray._banner);
            if (tray._bannerBin?.get_children) {
                for (const c of tray._bannerBin.get_children()) {
                    if (c && !banners.includes(c)) banners.push(c);
                }
            }

            if (hAlign === 'left') {
                tray._bannerBin.x_align = Clutter.ActorAlign.START;
                for (const b of banners) {
                    b.x_align = Clutter.ActorAlign.START;
                    b.x_expand = false;
                    b.margin_left = 32;
                    b.margin_right = 0;
                }
            } else if (hAlign === 'right') {
                tray._bannerBin.x_align = Clutter.ActorAlign.END;
                for (const b of banners) {
                    b.x_align = Clutter.ActorAlign.END;
                    b.x_expand = false;
                    b.margin_left = 0;
                    b.margin_right = 32;
                }
            } else {
                tray._bannerBin.x_align = Clutter.ActorAlign.CENTER;
                for (const b of banners) {
                    b.x_align = Clutter.ActorAlign.CENTER;
                    b.x_expand = false;
                    b.margin_left = 0;
                    b.margin_right = 0;
                }
            }
            tray.queue_relayout();
        } catch (e) {}
    }

    _setupOsdMonitorPatch() {
        try {
            if (!Main.osdWindowManager || this._origOsdShowAll) return;

            this._origOsdShowAll = Main.osdWindowManager.showAll;
            const self = this;

            Main.osdWindowManager.showAll = function(icon, label, level, maxLevel) {
                const osdMode = self._getSettingInt('osd-monitor', 0);

                // -1: На всех мониторах (поведение GNOME по умолчанию)
                if (osdMode === -1) {
                    return self._origOsdShowAll.call(this, icon, label, level, maxLevel);
                }

                const numMonitors = this._osdWindows?.length ?? 0;
                if (numMonitors === 0) return;

                let targetIndex = 0;
                if (osdMode === 0) {
                    targetIndex = Main.layoutManager?.primaryIndex ?? 0;
                } else {
                    targetIndex = Math.min(Math.max(0, osdMode - 1), numMonitors - 1);
                }

                if (typeof this.showOne === 'function') {
                    this.showOne(targetIndex, icon, label, level, maxLevel);
                } else if (this._osdWindows && this._osdWindows[targetIndex]) {
                    this._showOsdWindow(targetIndex, icon, label, level, maxLevel);
                    for (let i = 0; i < this._osdWindows.length; i++) {
                        if (i !== targetIndex && this._osdWindows[i]?.cancel) {
                            this._osdWindows[i].cancel();
                        }
                    }
                }
            };
        } catch (e) {
            console.error('[QPatcher] Failed to setup OSD monitor patch:', e);
        }
    }

    _restoreOsdMonitorPatch() {
        try {
            if (this._origOsdShowAll && Main.osdWindowManager) {
                Main.osdWindowManager.showAll = this._origOsdShowAll;
                this._origOsdShowAll = null;
            }
        } catch (e) {}
    }

    _setupKeyboardManagerHook() {
        try {
            let inputSourceProto = null;
            try {
                if (KeyboardStatus?.InputSource?.prototype) {
                    inputSourceProto = KeyboardStatus.InputSource.prototype;
                }
            } catch (e) {}

            const keyboard = Main.panel?.statusArea?.keyboard;
            const mgr = keyboard?._inputSourceManager;
            if (!inputSourceProto && mgr?._inputSources) {
                const sources = Object.values(mgr._inputSources);
                if (sources.length > 0) {
                    inputSourceProto = Object.getPrototypeOf(sources[0]);
                }
            }

            if (inputSourceProto && !this._origShortNameDesc) {
                this._origShortNameDesc = Object.getOwnPropertyDescriptor(inputSourceProto, 'shortName');
                this._inputSourceProto = inputSourceProto;
                const self = this;
                Object.defineProperty(inputSourceProto, 'shortName', {
                    get() {
                        const val = this._shortName;
                        if (self._getSettingBool('keyboard-uppercase') && typeof val === 'string') {
                            return val.toUpperCase();
                        }
                        return val;
                    },
                    set(v) {
                        this._shortName = v;
                        this.emit('changed');
                    },
                    configurable: true,
                    enumerable: true,
                });
            }

            if (Main.sessionMode && !this._sessionModeHookConnected) {
                this._sessionModeHookConnected = true;
                const id = Main.sessionMode.connect('updated', () => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._updateKeyboardLayoutText();
                        return GLib.SOURCE_REMOVE;
                    });
                });
                this._signals.push({ obj: Main.sessionMode, id });
            }

            if (Main.screenShield && !this._screenShieldHookConnected) {
                this._screenShieldHookConnected = true;
                const id1 = Main.screenShield.connect('locked-changed', () => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._updateKeyboardLayoutText();
                        return GLib.SOURCE_REMOVE;
                    });
                });
                const id2 = Main.screenShield.connect('active-changed', () => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._updateKeyboardLayoutText();
                        return GLib.SOURCE_REMOVE;
                    });
                });
                this._signals.push({ obj: Main.screenShield, id: id1 });
                this._signals.push({ obj: Main.screenShield, id: id2 });
            }

            if (!keyboard) return;

            let patching = false;
            const patchLabels = () => {
                if (patching) return;
                if (!this._getSettingBool('keyboard-uppercase')) return;
                patching = true;
                try {
                    const updateActorText = (actor) => {
                        if (!actor || actor.is_finalized?.()) return;
                        try {
                            if (actor.get_text && actor.set_text) {
                                const current = actor.get_text();
                                if (current && typeof current === 'string' && current.length <= 4 && current !== current.toUpperCase()) {
                                    actor.set_text(current.toUpperCase());
                                }
                            }
                            if (actor.get_children) {
                                for (const child of actor.get_children()) {
                                    updateActorText(child);
                                }
                            }
                        } catch (e) {}
                    };

                    updateActorText(keyboard);

                    if (keyboard._indicatorLabels) {
                        for (const label of Object.values(keyboard._indicatorLabels)) {
                            updateActorText(label);
                        }
                    }
                    if (keyboard._menuItems) {
                        for (const item of Object.values(keyboard._menuItems)) {
                            if (item?.indicator) updateActorText(item.indicator);
                        }
                    }
                } catch (e) {} finally {
                    patching = false;
                }
            };

            if (!keyboard._qpatcherStyleHook) {
                keyboard._qpatcherStyleHook = true;
                keyboard.connect('style-changed', patchLabels);
            }

            if (!this._origSetSourceAsActive && keyboard._setSourceAsActive) {
                this._origSetSourceAsActive = keyboard._setSourceAsActive;
                const self = this;
                keyboard._setSourceAsActive = function(source) {
                    const ret = self._origSetSourceAsActive.call(this, source);
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        patchLabels();
                        return GLib.SOURCE_REMOVE;
                    });
                    return ret;
                };
            }

            if (!this._origCurrentSourceChanged && keyboard._currentSourceChanged) {
                this._origCurrentSourceChanged = keyboard._currentSourceChanged;
                const self = this;
                keyboard._currentSourceChanged = function(manager, oldSource) {
                    const ret = self._origCurrentSourceChanged.call(this, manager, oldSource);
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        patchLabels();
                        return GLib.SOURCE_REMOVE;
                    });
                    return ret;
                };
            }

            if (!this._origSourcesChanged && keyboard._sourcesChanged) {
                this._origSourcesChanged = keyboard._sourcesChanged;
                const self = this;
                keyboard._sourcesChanged = function() {
                    const ret = self._origSourcesChanged.call(this);
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        patchLabels();
                        return GLib.SOURCE_REMOVE;
                    });
                    return ret;
                };
            }

            if (mgr) {
                const id = mgr.connect('current-source-changed', () => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        patchLabels();
                        return GLib.SOURCE_REMOVE;
                    });
                });
                this._signals.push({ obj: mgr, id });
            }

            patchLabels();
            this._updateKeyboardLayoutText();
        } catch (e) {}
    }

    _updateKeyboardLayoutText() {
        if (!this._getSettingBool('keyboard-uppercase')) return;
        try {
            const keyboard = Main.panel?.statusArea?.keyboard;
            if (keyboard?._inputSourceManager?._inputSources) {
                for (const is of Object.values(keyboard._inputSourceManager._inputSources)) {
                    try {
                        is.emit('changed');
                    } catch (e) {}
                }
            }

            const updateActorText = (actor) => {
                if (!actor || actor.is_finalized?.() || (actor instanceof Clutter.Actor && actor.is_in_destruction?.())) return;
                try {
                    if (actor.get_text && actor.set_text) {
                        const current = actor.get_text();
                        if (current && typeof current === 'string' && current.length <= 4 && current !== current.toUpperCase()) {
                            actor.set_text(current.toUpperCase());
                        }
                    }
                    if (actor.get_children) {
                        for (const child of actor.get_children()) {
                            updateActorText(child);
                        }
                    }
                } catch (e) {}
            };

            if (keyboard) {
                updateActorText(keyboard);

                if (keyboard._indicatorLabels) {
                    for (const label of Object.values(keyboard._indicatorLabels)) {
                        updateActorText(label);
                    }
                }
                if (keyboard._menuItems) {
                    for (const item of Object.values(keyboard._menuItems)) {
                        if (item?.indicator) updateActorText(item.indicator);
                    }
                }
            }

            const dialog = Main.screenShield?._dialog;
            if (dialog) {
                updateActorText(dialog);
            }
        } catch (e) {}
    }

    _restoreKeyboardManagerHook() {
        try {
            if (this._origShortNameDesc && this._inputSourceProto) {
                Object.defineProperty(this._inputSourceProto, 'shortName', this._origShortNameDesc);
                this._origShortNameDesc = null;
                this._inputSourceProto = null;
                if (Main.panel?.statusArea?.keyboard?._inputSourceManager?._inputSources) {
                    for (const is of Object.values(Main.panel.statusArea.keyboard._inputSourceManager._inputSources)) {
                        try { is.emit('changed'); } catch (e) {}
                    }
                }
            }
            if (this._origSetSourceAsActive && Main.panel?.statusArea?.keyboard) {
                Main.panel.statusArea.keyboard._setSourceAsActive = this._origSetSourceAsActive;
                this._origSetSourceAsActive = null;
            }
            if (this._origCurrentSourceChanged && Main.panel?.statusArea?.keyboard) {
                Main.panel.statusArea.keyboard._currentSourceChanged = this._origCurrentSourceChanged;
                this._origCurrentSourceChanged = null;
            }
            if (this._origSourcesChanged && Main.panel?.statusArea?.keyboard) {
                Main.panel.statusArea.keyboard._sourcesChanged = this._origSourcesChanged;
                this._origSourcesChanged = null;
            }
        } catch (e) {}
    }

    _setupClassPrototypePatches() {
        try {
            if (WindowPreview?.WindowPreview?.prototype) {
                const proto = WindowPreview.WindowPreview.prototype;
                if (!this._origShowOverlay && proto.showOverlay) {
                    this._origShowOverlay = proto.showOverlay;
                }
                if (!this._origWindowCanClose && proto._windowCanClose) {
                    this._origWindowCanClose = proto._windowCanClose;
                }
                if (!this._origGetCaption && proto._getCaption) {
                    this._origGetCaption = proto._getCaption;
                }
                if (!this._origUpdateIconScale && proto._updateIconScale) {
                    this._origUpdateIconScale = proto._updateIconScale;
                }

                const self = this;
                proto.showOverlay = function(animate) {
                    if (self._origShowOverlay) self._origShowOverlay.call(this, animate);
                    if (self._getSettingBool('overview-window-title-hide') && this._title) {
                        this._title.visible = false;
                        this._title.opacity = 0;
                    }
                };

                proto._windowCanClose = function() {
                    if (self._getSettingBool('overview-window-close-button-hide')) {
                        return false;
                    }
                    return self._origWindowCanClose ? self._origWindowCanClose.apply(this, arguments) : true;
                };

                proto._getCaption = function() {
                    if (self._getSettingBool('overview-window-title-hide')) {
                        if (this._title) {
                            this._title.visible = false;
                            this._title.opacity = 0;
                        }
                        return '';
                    }
                    if (this._title) this._title.visible = true;
                    return self._origGetCaption ? self._origGetCaption.apply(this, arguments) : '';
                };

                proto._updateIconScale = function() {
                    if (self._origUpdateIconScale) {
                        self._origUpdateIconScale.apply(this, arguments);
                    }
                    if (self._getSettingBool('overview-window-icon-hide') && this._icon) {
                        this._icon.opacity = 0;
                        this._icon.visible = false;
                    }
                };
            }

            if (Dash?.DashItemContainer?.prototype) {
                const proto = Dash.DashItemContainer.prototype;
                if (!this._origShowLabel && proto.showLabel) {
                    this._origShowLabel = proto.showLabel;
                    const self = this;
                    proto.showLabel = function() {
                        if (self._getSettingBool('dock-tooltips-hide')) {
                            return;
                        }
                        return self._origShowLabel.apply(this, arguments);
                    };
                }
            }
        } catch (e) {}
    }

    _restoreClassPrototypePatches() {
        try {
            if (WindowPreview?.WindowPreview?.prototype) {
                const proto = WindowPreview.WindowPreview.prototype;
                if (this._origShowOverlay) {
                    proto.showOverlay = this._origShowOverlay;
                    this._origShowOverlay = null;
                }
                if (this._origWindowCanClose) {
                    proto._windowCanClose = this._origWindowCanClose;
                    this._origWindowCanClose = null;
                }
                if (this._origGetCaption) {
                    proto._getCaption = this._origGetCaption;
                    this._origGetCaption = null;
                }
                if (this._origUpdateIconScale) {
                    proto._updateIconScale = this._origUpdateIconScale;
                    this._origUpdateIconScale = null;
                }
            }
            if (this._origShowLabel && Dash?.DashItemContainer?.prototype) {
                Dash.DashItemContainer.prototype.showLabel = this._origShowLabel;
                this._origShowLabel = null;
            }
        } catch (e) {}
    }

    _setupForceTopBarPatch() {
        try {
            if (!Main.layoutManager) return;
            const panelBox = Main.layoutManager.panelBox;
            if (!panelBox) return;

            const enabled = this._getSettingBool('topbar-show-in-fullscreen', false);

            if (Array.isArray(Main.layoutManager._trackedActors)) {
                for (const item of Main.layoutManager._trackedActors) {
                    if (item.actor === panelBox) {
                        item.trackFullscreen = !enabled;
                        break;
                    }
                }
            }

            if (!this._origLayoutUpdateVisibility) {
                this._origLayoutUpdateVisibility = Main.layoutManager._updateVisibility;
                const self = this;
                Main.layoutManager._updateVisibility = function() {
                    self._origLayoutUpdateVisibility.call(this);
                    if (self._getSettingBool('topbar-show-in-fullscreen', false)) {
                        if (panelBox) {
                            panelBox.visible = true;
                            panelBox.translation_y = 0;
                        }
                        if (Main.panel) {
                            Main.panel.show();
                            Main.panel.visible = true;
                        }
                    }
                };
            }

            Main.layoutManager._updateVisibility();
        } catch (e) {
            console.error('[QPatcher] Error setting up force topbar patch:', e);
        }
    }

    _restoreForceTopBarPatch() {
        try {
            if (this._origLayoutUpdateVisibility && Main.layoutManager) {
                Main.layoutManager._updateVisibility = this._origLayoutUpdateVisibility;
                this._origLayoutUpdateVisibility = null;
            }
            if (Main.layoutManager?.panelBox && Array.isArray(Main.layoutManager._trackedActors)) {
                for (const item of Main.layoutManager._trackedActors) {
                    if (item.actor === Main.layoutManager.panelBox) {
                        item.trackFullscreen = true;
                        break;
                    }
                }
            }
        } catch (e) {}
    }

    _updateDockVisibilityForSession(isLocked) {
        try {
            if (isLocked) {
                global.stage.add_style_class_name('qpatcher-screen-locked');
            } else {
                global.stage.remove_style_class_name('qpatcher-screen-locked');
            }

            const allDocks = DockManager?.allDocks || this._dockManager?._allDocks || [];
            allDocks.forEach(dock => {
                if (isLocked) {
                    dock.visible = false;
                    dock.opacity = 0;
                    dock.reactive = false;
                    dock.hide();
                } else {
                    dock.visible = true;
                    dock.opacity = 255;
                    dock.reactive = true;
                    dock.show();
                }
            });

            const uiGroup = this._getUiGroup();
            if (uiGroup) {
                for (const child of uiGroup.get_children()) {
                    if (child.name === 'dashtodockContainer' || (child.has_style_class_name && child.has_style_class_name('dashtodockContainer'))) {
                        if (isLocked) {
                            child.visible = false;
                            child.opacity = 0;
                            child.reactive = false;
                            child.hide();
                        } else {
                            child.visible = true;
                            child.opacity = 255;
                            child.reactive = true;
                            child.show();
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[QPatcher] Error updating dock session visibility:', e);
        }
    }

    _updateLockScreenDateMenu() {
        try {
            const enabled = this._getSettingBool('lockscreen-topbar-enable', true);
            const unlockMode = Main.sessionMode?._modes?.['unlock-dialog'];
            if (unlockMode?.panel) {
                if (enabled) {
                    if (!unlockMode.panel.center.includes('dateMenu')) {
                        unlockMode.panel.center = ['dateMenu'];
                    }
                } else {
                    const idx = unlockMode.panel.center.indexOf('dateMenu');
                    if (idx !== -1) unlockMode.panel.center.splice(idx, 1);
                }
            }

            if (Main.sessionMode?.currentMode === 'unlock-dialog') {
                if (enabled) {
                    if (!Main.sessionMode.panel.center.includes('dateMenu')) {
                        Main.sessionMode.panel.center = ['dateMenu'];
                    }
                    const dateMenu = Main.panel?.statusArea?.dateMenu;
                    if (dateMenu) {
                        if (dateMenu.container) {
                            dateMenu.container.visible = true;
                            dateMenu.container.show();
                        }
                        if (dateMenu._clockDisplay) {
                            dateMenu._clockDisplay.visible = true;
                        }
                        dateMenu.visible = true;
                    }
                }
                if (typeof Main.panel?._updatePanel === 'function') {
                    Main.panel._updatePanel();
                }
            }
        } catch (e) {
            console.error('[QPatcher] Error updating lockscreen dateMenu:', e);
        }
    }

    _applyMultiMonitorFixToDialog(dialog) {
        if (!dialog) return;
        try {
            const screenShieldGroup = Main.layoutManager?.screenShieldGroup;
            if (screenShieldGroup) {
                if (!dialog._qpatcherBound) {
                    dialog._qpatcherBound = true;
                    dialog.add_constraint(new Clutter.BindConstraint({
                        source: screenShieldGroup,
                        coordinate: Clutter.BindCoordinate.ALL,
                    }));
                }
                if (dialog._backgroundGroup && !dialog._backgroundGroup._qpatcherBound) {
                    dialog._backgroundGroup._qpatcherBound = true;
                    dialog._backgroundGroup.add_constraint(new Clutter.BindConstraint({
                        source: screenShieldGroup,
                        coordinate: Clutter.BindCoordinate.ALL,
                    }));
                }
            }

            if (Main.screenShield?._lockDialogGroup) {
                Main.screenShield._lockDialogGroup.style = 'background-color: transparent;';
            }

            const monitors = Main.layoutManager?.monitors || [];
            if (dialog._backgroundGroup && monitors.length > 0) {
                const children = dialog._backgroundGroup.get_children();
                children.forEach((widget, idx) => {
                    if (idx < monitors.length) {
                        const m = monitors[idx];
                        widget.set_position(m.x, m.y);
                        widget.set_size(m.width, m.height);
                        if (!widget.layout_manager) {
                            widget.layout_manager = new Clutter.BinLayout();
                        }
                        if (!widget._qpatcherConstraint) {
                            widget._qpatcherConstraint = true;
                            widget.add_constraint(new Layout.MonitorConstraint({ index: idx }));
                        }
                        for (const child of widget.get_children()) {
                            child.x_expand = true;
                            child.y_expand = true;
                        }
                        const effect = widget.get_effect('blur');
                        if (effect && typeof effect.queue_repaint === 'function') {
                            effect.queue_repaint();
                        }
                    }
                });
            }

            this._updateKeyboardLayoutText();
        } catch (e) {
            console.error('[QPatcher] Error applying multi-monitor fix to dialog:', e);
        }
    }

    _syncLockScreenBackgrounds() {
        try {
            const dialog = Main.screenShield?._dialog;
            if (!dialog) return;

            this._applyMultiMonitorFixToDialog(dialog);

            if (typeof dialog._updateBackgrounds === 'function') {
                dialog._updateBackgrounds();
            }
            if (typeof dialog._updateBackgroundEffects === 'function') {
                dialog._updateBackgroundEffects();
            }
        } catch (e) {
            console.error('[QPatcher] Error syncing lock screen backgrounds:', e);
        }
    }

    _setupScreenShieldPatch() {
        try {
            if (UnlockDialogModule?.UnlockDialog?.prototype) {
                const proto = UnlockDialogModule.UnlockDialog.prototype;
                if (!this._origUnlockDialogInit && proto._init) {
                    this._origUnlockDialogInit = proto._init;
                    const self = this;
                    proto._init = function(parentActor) {
                        self._origUnlockDialogInit.call(this, parentActor);
                        self._applyMultiMonitorFixToDialog(this);
                    };
                }

                if (!this._origUnlockDialogCreateBackground && proto._createBackground) {
                    this._origUnlockDialogCreateBackground = proto._createBackground;
                    const self = this;
                    proto._createBackground = function(monitorIndex) {
                        const monitor = Main.layoutManager.monitors[monitorIndex];
                        if (!monitor) return;

                        const widget = new St.Widget({
                            style_class: 'screen-shield-background',
                            x: monitor.x,
                            y: monitor.y,
                            width: monitor.width,
                            height: monitor.height,
                            effect: new Shell.BlurEffect({name: 'blur'}),
                            layout_manager: new Clutter.BinLayout(),
                        });
                        widget.add_constraint(new Layout.MonitorConstraint({ index: monitorIndex }));

                        const bgManager = new Background.BackgroundManager({
                            container: widget,
                            monitorIndex,
                            controlPosition: false,
                            useContentSize: false,
                        });

                        this._bgManagers.push(bgManager);

                        if (bgManager.backgroundActor) {
                            bgManager.backgroundActor.x_expand = true;
                            bgManager.backgroundActor.y_expand = true;
                        }

                        bgManager.connect('changed', () => {
                            if (bgManager.backgroundActor) {
                                bgManager.backgroundActor.x_expand = true;
                                bgManager.backgroundActor.y_expand = true;
                            }
                        });

                        this._backgroundGroup.add_child(widget);
                    };
                }
            }

            if (Main.screenShield) {
                if (Main.screenShield._lockDialogGroup) {
                    Main.screenShield._lockDialogGroup.style = 'background-color: transparent;';
                }

                if (Main.screenShield._dialog) {
                    this._applyMultiMonitorFixToDialog(Main.screenShield._dialog);
                }

                if (!this._origScreenShieldActivate) {
                    this._origScreenShieldActivate = Main.screenShield.activate;
                    const self = this;
                    Main.screenShield.activate = function(animate) {
                        if (!self._getSettingBool('lockscreen-prevent-blank')) {
                            const res = self._origScreenShieldActivate.call(this, animate);
                            if (this._dialog) self._applyMultiMonitorFixToDialog(this._dialog);
                            return res;
                        }

                        if (this._activationTime === 0)
                            this._activationTime = GLib.get_monotonic_time();

                        if (!this._ensureUnlockDialog(true))
                            return;

                        if (this._dialog) {
                            self._applyMultiMonitorFixToDialog(this._dialog);
                        }

                        this.actor.show();

                        if (Main.sessionMode.currentMode !== 'unlock-dialog') {
                            this._isGreeter = Main.sessionMode.isGreeter;
                            if (!this._isGreeter)
                                Main.sessionMode.pushMode('unlock-dialog');
                        }

                        this._resetLockScreen({
                            animateLockScreen: animate,
                            fadeToBlack: false,
                        });
                    };
                }

                if (!this._origScreenShieldSetActive) {
                    this._origScreenShieldSetActive = Main.screenShield._setActive;
                    const self = this;
                    Main.screenShield._setActive = function(active) {
                        if (self._getSettingBool('lockscreen-prevent-blank') && active) {
                            // Suppress active=true to keep gsd-power from blanking the screen
                            return;
                        }
                        self._origScreenShieldSetActive.call(this, active);
                    };
                }

                if (!this._monitorManagerPowerSaveId && global.backend?.get_monitor_manager) {
                    const mm = global.backend.get_monitor_manager();
                    if (mm) {
                        this._monitorManagerPowerSaveId = mm.connect('power-save-mode-changed', () => {
                            if (this._getSettingBool('lockscreen-prevent-blank') &&
                                Main.sessionMode?.currentMode === 'unlock-dialog') {
                                if (typeof mm.get_power_save_mode === 'function' && mm.get_power_save_mode() !== 0) {
                                    mm.set_power_save_mode(0);
                                }
                            }
                        });
                        this._signals.push({ obj: mm, id: this._monitorManagerPowerSaveId });
                    }
                }

                const triggerPromptDirectly = () => {
                    this._syncLockScreenBackgrounds();
                    if (!this._getSettingBool('lockscreen-auto-focus-password', true))
                        return;

                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        try {
                            const dialog = Main.screenShield?._dialog;
                            if (dialog && typeof dialog.activate === 'function') {
                                dialog.activate();
                            }
                        } catch (e) {}
                        return GLib.SOURCE_REMOVE;
                    });
                };

                if (!this._screenShieldLockShownId) {
                    this._screenShieldLockShownId = Main.screenShield.connect('lock-screen-shown', triggerPromptDirectly);
                    this._signals.push({ obj: Main.screenShield, id: this._screenShieldLockShownId });
                }

                if (!this._screenShieldWakeUpId) {
                    this._screenShieldWakeUpId = Main.screenShield.connect('wake-up-screen', triggerPromptDirectly);
                    this._signals.push({ obj: Main.screenShield, id: this._screenShieldWakeUpId });
                }
            }
        } catch (e) {
            console.error('[QPatcher] Error in _setupScreenShieldPatch:', e);
        }
    }

    _restoreScreenShieldPatch() {
        try {
            if (this._origUnlockDialogInit && UnlockDialogModule?.UnlockDialog?.prototype) {
                UnlockDialogModule.UnlockDialog.prototype._init = this._origUnlockDialogInit;
                this._origUnlockDialogInit = null;
            }
            if (this._origUnlockDialogCreateBackground && UnlockDialogModule?.UnlockDialog?.prototype) {
                UnlockDialogModule.UnlockDialog.prototype._createBackground = this._origUnlockDialogCreateBackground;
                this._origUnlockDialogCreateBackground = null;
            }
            if (Main.screenShield?._lockDialogGroup) {
                Main.screenShield._lockDialogGroup.style = null;
            }
            if (this._origScreenShieldActivate && Main.screenShield) {
                Main.screenShield.activate = this._origScreenShieldActivate;
                this._origScreenShieldActivate = null;
            }
            if (this._origScreenShieldSetActive && Main.screenShield) {
                Main.screenShield._setActive = this._origScreenShieldSetActive;
                this._origScreenShieldSetActive = null;
            }
            if (this._monitorManagerPowerSaveId && global.backend?.get_monitor_manager) {
                const mm = global.backend.get_monitor_manager();
                if (mm) {
                    mm.disconnect(this._monitorManagerPowerSaveId);
                }
                this._monitorManagerPowerSaveId = 0;
            }
            if (this._origLoginDialogLoadUserList) {
                import('resource:///org/gnome/shell/gdm/loginDialog.js').then(LoginDialogMod => {
                    if (LoginDialogMod?.LoginDialog?.prototype) {
                        LoginDialogMod.LoginDialog.prototype._loadUserList = this._origLoginDialogLoadUserList;
                    }
                }).catch(() => {});
                this._origLoginDialogLoadUserList = null;
            }
        } catch (e) {}
    }

    _applyDashToDockSeparatorFix(show) {
        try {
            const actors = global.stage.get_children();
            for (const actor of actors) {
                if (actor.name === 'dashtodockContainer' || (actor.has_style_class_name && actor.has_style_class_name('dashtodockContainer'))) {
                    this._toggleChildrenSeparators(actor, show);
                }
            }
        } catch (e) {}
    }

    _toggleChildrenSeparators(parent, show) {
        if (!parent || !parent.get_children) return;
        for (const child of parent.get_children()) {
            if (child.has_style_class_name && child.has_style_class_name('dash-separator')) {
                child.visible = show;
                child.opacity = show ? 255 : 0;
            }
            this._toggleChildrenSeparators(child, show);
        }
    }

    disable() {
        for (const signal of this._signals) {
            signal.obj.disconnect(signal.id);
        }
        this._signals = [];

        try {
            Main.wm.removeKeybinding('clipboard-shortcut');
            Main.wm.removeKeybinding('emoji-shortcut');
        } catch (_) {}

        if (this._dbusRegistrationId) {
            Gio.DBus.session.unregister_object(this._dbusRegistrationId);
            this._dbusRegistrationId = 0;
        }

        if (this._clipboardIndicator) {
            this._clipboardIndicator.destroy();
            this._clipboardIndicator = null;
        }

        if (this._clipboardHistoryManager) {
            this._clipboardHistoryManager.stop();
            this._clipboardHistoryManager = null;
        }
        if (this._clipboardDialog) {
            this._clipboardDialog.destroy();
            this._clipboardDialog = null;
        }
        this._emojiManager = null;

        // Восстанавливаем оригинальные методы клавиатуры
        this._restoreKeyboardManagerHook();
        this._sessionModeHookConnected = false;
        this._screenShieldHookConnected = false;

        this._restoreClassPrototypePatches();
        this._restoreScreenShieldPatch();
        this._restoreOsdMonitorPatch();
        this._restoreForceTopBarPatch();
        if (this._origUpdateBoxes && Main.layoutManager) {
            Main.layoutManager._updateBoxes = this._origUpdateBoxes;
            this._origUpdateBoxes = null;
        }
        this._removeWindowConstraints();
        this._updateDockVisibilityForSession(false);
        const unlockMode = Main.sessionMode?._modes?.['unlock-dialog'];
        if (unlockMode?.panel?.center) {
            const idx = unlockMode.panel.center.indexOf('dateMenu');
            if (idx !== -1) unlockMode.panel.center.splice(idx, 1);
        }
        this._destroyOverviewBlur();

        const controls = Main.overview?._overview?._controls;
        if (controls?._searchEntry) controls._searchEntry.visible = true;
        if (controls?._searchEntryBin) controls._searchEntryBin.visible = true;
        if (controls?._searchController) controls._searchController._qpatcherSearchActiveHooked = false;
        if (controls?._searchEntry?.clutter_text) controls._searchEntry.clutter_text._qpatcherTextHooked = false;
        if (Main.overview) Main.overview._qpatcherSearchOverviewHooked = false;

        const uiGroup = this._getUiGroup();
        const classesToRemove = [
            'qpatcher-hide-panel-notification-icon',
            'qpatcher-hide-a11y',
            'qpatcher-hide-dock-notification-badge',
            'qpatcher-badge-accent',
            'qpatcher-recolor-menus',
            'qpatcher-menus-theme',
            'qpatcher-notification-theme',
            'qpatcher-no-dock-separator',
            'qpatcher-no-dock-show-apps',
            'qpatcher-no-dock-running-dots',
            'qpatcher-no-dock-tooltips',
            'qpatcher-no-window-close',
            'qpatcher-no-window-icon',
            'qpatcher-no-window-title',
            'qpatcher-no-overview-search',
            'qpatcher-no-overview-thumbnails',
            'qpatcher-no-notification-close',
            'qpatcher-hide-calendar',
            'qpatcher-hide-calendar-column',
            'qpatcher-compact-empty-notifications'
        ];
        if (uiGroup) {
            classesToRemove.forEach(cls => uiGroup.remove_style_class_name(cls));
        }

        if (this._dynamicStylesheetLoaded) {
            try {
                const cssPath = GLib.build_filenamev([this.path, 'qpatcher-dynamic.css']);
                const file = Gio.File.new_for_path(cssPath);
                const theme = St.ThemeContext.get_for_stage(global.stage)?.get_theme();
                if (theme) theme.unload_stylesheet(file);
            } catch (e) {}
            this._dynamicStylesheetLoaded = false;
        }

        if (Main.panel) {
            Main.panel.visible = true;
            Main.panel.opacity = 255;
            Main.panel.set_style('');
            Main.panel.remove_style_class_name('qpatcher-topbar-transparent');
            Main.panel.remove_style_class_name('qpatcher-topbar-theme');
            Main.panel.remove_style_class_name('qpatcher-topbar-transparent-in-overview');
            if (Main.panel.statusArea?.quickSettings?.container) {
                Main.panel.statusArea.quickSettings.container.visible = true;
            }
        }

        const dateMenu = Main.panel?.statusArea?.dateMenu;
        if (dateMenu) {
            const calendarCol = dateMenu._calendar?.get_parent() || dateMenu._calendarColumn;
            if (calendarCol) calendarCol.visible = true;
            if (dateMenu._calendar) dateMenu._calendar.visible = true;
            if (dateMenu._date) dateMenu._date.visible = true;
            if (dateMenu.menu?.box) {
                dateMenu.menu.box.set_style(null);
                dateMenu.menu.box.remove_style_class_name('qpatcher-datemenu-theme');
            }
        }

        const qs = Main.panel?.statusArea?.quickSettings;
        if (qs) {
            const systemItem = qs._system?.quickSettingsItems?.[0] || qs._system?._systemItem;
            const box = systemItem?.child;
            if (box?.get_children) {
                for (const child of box.get_children()) {
                    const type = child.constructor.name;
                    if (type === 'ScreenshotItem' || type === 'SettingsItem' || type === 'LockItem' || type === 'ShutdownItem') {
                        child.visible = true;
                    }
                }
            }
            if (qs.menu?.box) {
                qs.menu.box.set_style(null);
                qs.menu.box.remove_style_class_name('qpatcher-qs-theme');
            }
        }

        if (Main.messageTray?._bannerBin) {
            Main.messageTray._bannerBin.x_align = Clutter.ActorAlign.CENTER;
            Main.messageTray._bannerBin.margin_left = 0;
            Main.messageTray._bannerBin.margin_right = 0;
            const constraints = Main.messageTray.get_constraints();
            for (const c of constraints) {
                if (c && 'primary' in c) {
                    c.primary = true;
                }
            }
            Main.messageTray.queue_relayout();
        }

        this._applyDashToDockSeparatorFix(true);
        this._cleanupScreenshotCustomizations();

        if (this._dockManager) {
            try {
                this._dockManager.destroy();
            } catch (e) {
                console.error('[QPatcher] Error destroying DockManager on disable:', e);
            }
            this._dockManager = null;
        }

        this._settings = null;
        this._interfaceSettings = null;
        this._a11ySettings = null;
        this._shellSettings = null;
    }

    // ==========================================
    // СКРИНШОТЫ (SCREENSHOTS CUSTOMIZATION)
    // ==========================================
    _setupScreenshotCustomizations() {
        if (!Main.screenshotUI) return;

        if (!this._origSaveScreenshot) {
            this._origSaveScreenshot = Main.screenshotUI._saveScreenshot;
        }

        const self = this;

        if (!this._origScreenshotOpen) {
            this._origScreenshotOpen = Main.screenshotUI.open;
            Main.screenshotUI.open = async function(...args) {
                const res = await self._origScreenshotOpen.apply(this, args);
                try {
                    const showPointer = self._getSettingBool('screenshot-show-pointer');
                    if (this._showPointerButton && this._showPointerButton.checked !== showPointer) {
                        this._showPointerButton.checked = showPointer;
                    }
                } catch (e) {}
                return res;
            };
        }

        if (Main.screenshotUI._showPointerButton && !Main.screenshotUI._showPointerButton._qpatcherPointerHooked) {
            Main.screenshotUI._showPointerButton._qpatcherPointerHooked = true;
            Main.screenshotUI._showPointerButton.connect('notify::checked', () => {
                this._setSettingBool('screenshot-show-pointer', Main.screenshotUI._showPointerButton.checked);
            });
        }

        Main.screenshotUI._saveScreenshot = async function() {
            let file = null;

            if (this._selectionButton.checked || this._screenButton.checked) {
                const content = this._stageScreenshot.get_content();
                if (!content)
                    return;

                const texture = content.get_texture();
                const geometry = this._getSelectedGeometry(true);

                let cursorTexture = this._cursor.content?.get_texture();
                if (!this._cursor.visible)
                    cursorTexture = null;

                try {
                    file = await self._captureScreenshotCustom(
                        texture, geometry, this._scale,
                        {
                            texture: cursorTexture ?? null,
                            x: this._cursor.x * this._scale,
                            y: this._cursor.y * this._scale,
                            scale: this._cursorScale,
                        }
                    );
                } catch (e) {
                    console.error('[QPatcher] Error capturing area/screen screenshot:', e);
                }
            } else if (this._windowButton.checked) {
                const window =
                    this._windowSelectors.flatMap(selector => selector.windows())
                                         .find(win => win.checked);
                if (!window)
                    return;

                const content = window.windowContent;
                if (!content)
                    return;

                const texture = content.get_texture();

                let cursorTexture = window.getCursorTexture()?.get_texture();
                if (!this._cursor.visible)
                    cursorTexture = null;

                try {
                    file = await self._captureScreenshotCustom(
                        texture,
                        null,
                        window.bufferScale,
                        {
                            texture: cursorTexture ?? null,
                            x: window.cursorPoint.x * window.bufferScale,
                            y: window.cursorPoint.y * window.bufferScale,
                            scale: this._cursorScale,
                        }
                    );
                } catch (e) {
                    console.error('[QPatcher] Error capturing window screenshot:', e);
                }
            }

            if (file)
                this.emit('screenshot-taken', file);
        };

        try {
            const soundPlayer = global.display?.get_sound_player();
            if (soundPlayer) {
                const proto = Object.getPrototypeOf(soundPlayer);
                const target = proto?.play_from_file ? proto : soundPlayer;
                if (!this._origPlayFromFile) {
                    this._origPlayFromFile = target.play_from_file;
                    const self = this;
                    target.play_from_file = function(file, event, cancellable) {
                        const filePath = file?.get_path ? file.get_path() : '';
                        if (filePath && (filePath.endsWith('screen-capture.oga') || filePath.endsWith('camera-shutter.oga') || filePath.endsWith('audio-volume-change.oga'))) {
                            const soundMode = self._getSettingString('screenshot-sound', 'bubble');
                            if (soundMode === 'disabled')
                                return;

                            self._playScreenshotSound();
                            return;
                        }
                        return self._origPlayFromFile.call(this, file, event, cancellable);
                    };
                }
            }
        } catch (e) {
            console.warn('[QPatcher] Sound player hook skipped:', e);
        }

        if (Main.screenshotUI._areaSelector) {
            const areaSelector = Main.screenshotUI._areaSelector;

            this._dragStartedSignalId = areaSelector.connect('drag-started', () => {
                if (areaSelector._topLeftHandle) areaSelector._topLeftHandle.visible = true;
                if (areaSelector._topRightHandle) areaSelector._topRightHandle.visible = true;
                if (areaSelector._bottomLeftHandle) areaSelector._bottomLeftHandle.visible = true;
                if (areaSelector._bottomRightHandle) areaSelector._bottomRightHandle.visible = true;
            });

            this._dragEndedSignalId = areaSelector.connect('drag-ended', () => {
                if (!this._getSettingBool('screenshot-quick-capture')) return;
                if (!Main.screenshotUI?.visible || !Main.screenshotUI?._selectionButton?.checked) return;

                const [x, y, w, h] = areaSelector.getGeometry();
                if (w > 20 && h > 20) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (Main.screenshotUI?.visible && Main.screenshotUI?._selectionButton?.checked) {
                            Main.screenshotUI._onCaptureButtonClicked().catch(err => console.error(err));
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        }

        const updatePanelVisibility = () => {
            const hidePanel = this._getSettingBool('screenshot-hide-panel', false);
            if (Main.screenshotUI) {
                if (hidePanel) {
                    Main.screenshotUI.add_style_class_name('qpatcher-screenshot-hide-panel');
                    if (Main.screenshotUI._panel) Main.screenshotUI._panel.visible = false;
                    if (Main.screenshotUI._closeButton) Main.screenshotUI._closeButton.visible = false;
                } else {
                    Main.screenshotUI.remove_style_class_name('qpatcher-screenshot-hide-panel');
                    if (Main.screenshotUI._panel) Main.screenshotUI._panel.visible = true;
                    if (Main.screenshotUI._closeButton) Main.screenshotUI._closeButton.visible = true;
                }
            }
        };

        if (this._settings?.settings_schema?.has_key('screenshot-hide-panel')) {
            this._screenshotHidePanelSignalId = this._settings.connect('changed::screenshot-hide-panel', updatePanelVisibility);
        }
        updatePanelVisibility();

        this._screenshotUiOpenSignalId = Main.screenshotUI.connect('notify::visible', () => {
            if (Main.screenshotUI.visible) {
                updatePanelVisibility();

                // Сброс области выделения по умолчанию (начинаем с чистого экрана)
                if (this._getSettingBool('screenshot-clear-selection', true)) {
                    const areaSelector = Main.screenshotUI._areaSelector;
                    if (areaSelector) {
                        areaSelector._startX = 0;
                        areaSelector._startY = 0;
                        areaSelector._lastX = 0;
                        areaSelector._lastY = 0;
                        areaSelector._areaIndicator?.setSelectionRect(0, 0, 0, 0);
                        if (areaSelector._topLeftHandle) areaSelector._topLeftHandle.visible = false;
                        if (areaSelector._topRightHandle) areaSelector._topRightHandle.visible = false;
                        if (areaSelector._bottomLeftHandle) areaSelector._bottomLeftHandle.visible = false;
                        if (areaSelector._bottomRightHandle) areaSelector._bottomRightHandle.visible = false;
                    }
                }
            }
        });
    }

    _playScreenshotSound() {
        try {
            const soundMode = this._getSettingString('screenshot-sound', 'bubble');
            if (soundMode === 'disabled')
                return;

            let soundFile = '/usr/share/sounds/freedesktop/stereo/audio-volume-change.oga';
            if (soundMode === 'default') {
                if (GLib.file_test('/usr/share/sounds/freedesktop/stereo/screen-capture.oga', GLib.FileTest.EXISTS)) {
                    soundFile = '/usr/share/sounds/freedesktop/stereo/screen-capture.oga';
                } else if (GLib.file_test('/usr/share/sounds/freedesktop/stereo/camera-shutter.oga', GLib.FileTest.EXISTS)) {
                    soundFile = '/usr/share/sounds/freedesktop/stereo/camera-shutter.oga';
                } else {
                    soundFile = `${global.datadir}/sounds/screen-capture.oga`;
                }
            }

            if (GLib.file_test(soundFile, GLib.FileTest.EXISTS)) {
                const player = GLib.find_program_in_path('pw-play') ||
                               GLib.find_program_in_path('paplay');
                if (player) {
                    try {
                        Gio.Subprocess.new([player, soundFile], Gio.SubprocessFlags.NONE);
                    } catch (e) {
                        const file = Gio.File.new_for_path(soundFile);
                        global.display?.get_sound_player()?.play_from_file(file, 'Screenshot taken', null);
                    }
                } else {
                    try {
                        const file = Gio.File.new_for_path(soundFile);
                        global.display?.get_sound_player()?.play_from_file(file, 'Screenshot taken', null);
                    } catch (e) {}
                }
            }
        } catch (e) {
            console.error('[QPatcher] Failed to play screenshot sound:', e);
        }
    }

    async _captureScreenshotCustom(texture, geometry, scale, cursor) {
        const stream = Gio.MemoryOutputStream.new_resizable();
        const texWidth = texture.get_width();
        const texHeight = texture.get_height();

        let x = 0;
        let y = 0;
        let w = texWidth;
        let h = texHeight;

        if (geometry && Array.isArray(geometry)) {
            let [gx, gy, gw, gh] = geometry;

            // Если область не была явно выделена (0x0 или 1x1 при сбросе) или невалидна
            if ((gw <= 2 && gh <= 2) || gw <= 0 || gh <= 0) {
                // Полноэкранный захват обоих мониторов (строго точные размеры текстуры, НЕ -1, -1)
                x = 0;
                y = 0;
                w = texWidth;
                h = texHeight;
            } else {
                gx = Math.round(gx);
                gy = Math.round(gy);
                gw = Math.round(gw);
                gh = Math.round(gh);

                // Ограничиваем начальные координаты в пределах текстуры
                x = Math.max(0, Math.min(gx, texWidth - 1));
                y = Math.max(0, Math.min(gy, texHeight - 1));

                // Если начальная точка была за левым/верхним краем, компенсируем ширину/высоту
                if (gx < 0) gw += gx;
                if (gy < 0) gh += gy;

                // Строго ограничиваем ширину и высоту, чтобы x + w <= texWidth и y + h <= texHeight
                w = Math.max(1, Math.min(gw, texWidth - x));
                h = Math.max(1, Math.min(gh, texHeight - y));
            }
        }

        if (cursor === null) {
            cursor = { texture: null, x: 0, y: 0, scale: 1 };
        }

        this._playScreenshotSound();

        const pixbuf = await Shell.Screenshot.composite_to_stream(
            texture,
            x, y, w, h,
            scale,
            cursor.texture, cursor.x, cursor.y, cursor.scale,
            stream
        );

        stream.close(null);
        return this._storeScreenshotCustom(stream.steal_as_bytes(), pixbuf);
    }

    _storeScreenshotCustom(bytes, pixbuf) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);

        const time = GLib.DateTime.new_now_local();
        let file = null;

        const clipboardOnly = this._getSettingBool('screenshot-clipboard-only', false);
        const filenameFormat = this._getSettingString('screenshot-filename-format', 'date');

        if (!clipboardOnly) {
            const picturesDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir();
            const saveLocation = this._getSettingString('screenshot-save-location', 'subfolder');

            let dir;
            if (saveLocation === 'pictures') {
                dir = Gio.File.new_for_path(picturesDir);
            } else {
                let screenshotsSubdir = 'Снимки экрана';
                const testDir = Gio.File.new_for_path(GLib.build_filenamev([picturesDir, screenshotsSubdir]));
                if (!testDir.query_exists(null)) {
                    const testEn = Gio.File.new_for_path(GLib.build_filenamev([picturesDir, 'Screenshots']));
                    if (testEn.query_exists(null)) screenshotsSubdir = 'Screenshots';
                }

                dir = Gio.File.new_for_path(GLib.build_filenamev([picturesDir, screenshotsSubdir]));
                try {
                    dir.make_directory_with_parents(null);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                        console.error('[QPatcher] Error creating screenshots directory:', e);
                    }
                }
            }

            let baseName = '';
            if (filenameFormat === 'random') {
                let code = '';
                for (let i = 0; i < 6; i++) {
                    code += Math.floor(Math.random() * 10).toString();
                }
                baseName = code;
            } else if (filenameFormat === 'date') {
                baseName = time.format('%Y-%m-%d_%H.%M.%S');
            } else {
                const timestamp = time.format('%Y-%m-%d %H-%M-%S');
                baseName = `Снимок экрана от ${timestamp}`;
            }

            file = Gio.File.new_for_path(GLib.build_filenamev([
                dir.get_path(), `${baseName}.png`,
            ]));

            let suffix = 1;
            while (file.query_exists(null)) {
                file = Gio.File.new_for_path(GLib.build_filenamev([
                    dir.get_path(), `${baseName}-${suffix}.png`,
                ]));
                suffix++;
            }

            try {
                const outStream = file.create(Gio.FileCreateFlags.NONE, null);
                outStream.write_bytes(bytes, null);
                outStream.close(null);
            } catch (e) {
                console.error('[QPatcher] Failed to write screenshot file:', e);
            }

            this._saveRecentScreenshot(file);
        }

        this._showScreenshotNotification(time, pixbuf, file, clipboardOnly);

        return file;
    }

    _saveRecentScreenshot(screenshotFile) {
        if (!screenshotFile) return;
        try {
            const recentFile = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
            const uri = screenshotFile.get_uri();
            const bookmarks = new GLib.BookmarkFile();
            try {
                bookmarks.load_from_file(recentFile);
            } catch (e) {
                if (!e.matches(GLib.FileError, GLib.FileError.NOENT))
                    return;
            }
            bookmarks.add_application(uri, GLib.get_prgname(), 'gio open %u');
            bookmarks.to_file(recentFile);
        } catch (e) {}
    }

    _showScreenshotNotification(time, pixbuf, file, clipboardOnly) {
        let icon = null;
        try {
            if (pixbuf) {
                const coglContext = global.stage.context.get_backend().get_cogl_context();
                const pixels = pixbuf.read_pixel_bytes();
                const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
                content.set_bytes(
                    coglContext,
                    pixels,
                    Cogl.PixelFormat.RGBA_8888,
                    pixbuf.width,
                    pixbuf.height,
                    pixbuf.rowstride
                );
                icon = content;
            }
        } catch (e) {}

        if (!this._screenshotSource) {
            this._screenshotSource = new MessageTray.Source({
                title: 'Снимок экрана',
                iconName: 'screenshooter-symbolic',
            });
            this._screenshotSource.connect('destroy', () => {
                this._screenshotSource = null;
            });
            Main.messageTray.add(this._screenshotSource);
        }

        const title = clipboardOnly ? 'Снимок скопирован' : 'Снимок сохранён';
        const body = clipboardOnly
            ? 'Изображение скопировано в буфер обмена'
            : 'Изображение сохранено и скопировано в буфер обмена';

        const notification = new MessageTray.Notification({
            source: this._screenshotSource,
            title,
            body,
            datetime: time,
            gicon: icon,
            isTransient: true,
        });

        if (file && !clipboardOnly) {
            notification.addAction('Показать в файлах', () => {
                try {
                    const app = Gio.app_info_get_default_for_type('inode/directory', false);
                    if (app) app.launch([file], null);
                } catch (e) {
                    console.error(e);
                }
            });
        }

        this._screenshotSource.addNotification(notification);
    }

    _cleanupScreenshotCustomizations() {
        if (Main.screenshotUI) {
            if (this._origScreenshotOpen) {
                Main.screenshotUI.open = this._origScreenshotOpen;
                this._origScreenshotOpen = null;
            }
            if (this._origSaveScreenshot) {
                Main.screenshotUI._saveScreenshot = this._origSaveScreenshot;
                this._origSaveScreenshot = null;
            }
            if (this._dragStartedSignalId && Main.screenshotUI._areaSelector) {
                Main.screenshotUI._areaSelector.disconnect(this._dragStartedSignalId);
                this._dragStartedSignalId = null;
            }
            if (this._dragEndedSignalId && Main.screenshotUI._areaSelector) {
                Main.screenshotUI._areaSelector.disconnect(this._dragEndedSignalId);
                this._dragEndedSignalId = null;
            }
            if (this._screenshotUiOpenSignalId) {
                Main.screenshotUI.disconnect(this._screenshotUiOpenSignalId);
                this._screenshotUiOpenSignalId = null;
            }
            if (this._screenshotHidePanelSignalId) {
                try {
                    this._settings?.disconnect(this._screenshotHidePanelSignalId);
                } catch (e) {}
                this._screenshotHidePanelSignalId = null;
            }
            Main.screenshotUI.remove_style_class_name('qpatcher-screenshot-hide-panel');
            if (Main.screenshotUI._panel) Main.screenshotUI._panel.visible = true;
            if (Main.screenshotUI._closeButton) Main.screenshotUI._closeButton.visible = true;
        }

        try {
            const soundPlayer = global.display?.get_sound_player();
            if (soundPlayer && this._origPlayFromFile) {
                const proto = Object.getPrototypeOf(soundPlayer);
                if (proto?.play_from_file)
                    proto.play_from_file = this._origPlayFromFile;
                soundPlayer.play_from_file = this._origPlayFromFile;
                this._origPlayFromFile = null;
            }
        } catch (e) {}

        if (this._screenshotSource) {
            this._screenshotSource.destroy();
            this._screenshotSource = null;
        }
    }
}
