import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

function execSubprocess(argv) {
    return new Promise((resolve, reject) => {
        try {
            const proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout, stderr] = p.communicate_utf8_finish(res);
                    resolve({ stdout, stderr });
                } catch (err) {
                    reject(err);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

export const QPatcherBatteryIndicator = GObject.registerClass(
    class QPatcherBatteryIndicator extends PanelMenu.Button {
        constructor(extension, settings) {
            super(0.5, 'QPatcher Peripheral Battery', false);

            this._extension = extension;
            this._settings = settings;
            this._pollTimeoutId = null;
            this._isQuerying = false;
            this._latestData = null;
            this._accentSig = null;

            // Panel Actor: Icon and optional Percentage Label
            this._box = new St.BoxLayout({
                style_class: 'panel-status-indicators-box',
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._icon = new St.Icon({
                icon_name: 'battery-level-100-symbolic',
                style_class: 'system-status-icon',
            });
            this._box.add_child(this._icon);

            this._label = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'qpatcher-battery-panel-label',
            });
            this._label.hide();
            this._box.add_child(this._label);

            this.add_child(this._box);

            this._buildMenu();

            // Load initial state instantly from cache file if available
            const cached = this._readCachedData();
            if (cached) {
                this._applyData(cached, false);
            }

            this.menu.connect('open-state-changed', (_menu, isOpen) => {
                if (isOpen) {
                    this.refresh(false);
                }
            });

            this._updatePanelLabelVisibility();
            if (this._settings?.settings_schema?.has_key('battery-show-percentage-in-panel')) {
                this._settingsSig = this._settings.connect('changed::battery-show-percentage-in-panel', () => {
                    this._updatePanelLabelVisibility();
                });
            }

            if (this._extension?._interfaceSettings) {
                this._accentSig = this._extension._interfaceSettings.connect('changed::accent-color', () => {
                    this._updateRefreshBtnStyle();
                    if (this._latestData) {
                        this._applyData(this._latestData, false);
                    }
                });
            }

            this.startPolling();
        }

        _getAccentColor() {
            return this._extension?._getAccentHex?.() || '#5e6f82';
        }

        _updateRefreshBtnStyle() {
            if (!this._refreshBtn) return;
            const accent = this._getAccentColor();
            this._refreshBtn.style = `padding: 4px 16px; border-radius: 8px; background-color: ${accent}; color: #ffffff;`;
        }

        _readCachedData() {
            try {
                const [ok, contents] = GLib.file_get_contents('/tmp/qpatcher_peripheral_battery.json');
                if (ok) {
                    const str = new TextDecoder().decode(contents);
                    return JSON.parse(str);
                }
            } catch (e) {}
            return null;
        }

        _updatePanelLabelVisibility() {
            try {
                const showPct = this._settings?.get_boolean('battery-show-percentage-in-panel') || false;
                if (showPct && this._label.text) {
                    this._label.show();
                } else {
                    this._label.hide();
                }
            } catch (e) {}
        }

        _getBatteryIconName(level, charging) {
            if (level === null || level === undefined) {
                return 'battery-missing-symbolic';
            }
            const rounded = Math.min(100, Math.max(0, Math.round(level / 10) * 10));
            const chgStr = charging ? '-charging' : '';
            return `battery-level-${rounded}${chgStr}-symbolic`;
        }

        _animateRefresh() {
            if (!this._refreshIcon) return;
            try {
                this._refreshIcon.set_pivot_point(0.5, 0.5);
                this._refreshIcon.rotation_angle_z = 0;
                this._refreshIcon.ease({
                    rotation_angle_z: 360,
                    duration: 550,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => {
                        try {
                            this._refreshIcon.rotation_angle_z = 0;
                        } catch (_) {}
                    },
                });
            } catch (_) {}
        }

        _flashBadge(actor) {
            if (!actor) return;
            try {
                actor.opacity = 100;
                actor.ease({
                    opacity: 255,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } catch (_) {}
        }

        _buildMenu() {
            this.menu.removeAll();

            // Header: title with wide accent-colored interactive refresh button
            const headerItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });
            const headerBox = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const titleLabel = new St.Label({
                text: 'Peripheral Devices',
                style: 'font-weight: bold; font-size: 13px;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.add_child(titleLabel);

            this._refreshIcon = new St.Icon({
                icon_name: 'view-refresh-symbolic',
                icon_size: 14,
                style: 'color: #ffffff;',
            });
            this._refreshIcon.set_pivot_point(0.5, 0.5);

            this._refreshBtn = new St.Button({
                style_class: 'button',
                can_focus: true,
                child: this._refreshIcon,
            });
            this._updateRefreshBtnStyle();

            this._refreshBtn.connect('clicked', () => {
                this.refresh(true);
            });
            headerBox.add_child(this._refreshBtn);

            headerItem.add_child(headerBox);
            this.menu.addMenuItem(headerItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // 1. Mouse item (VXE Dragonfly R1+) - Single clean row
            this._mouseItem = new PopupMenu.PopupBaseMenuItem({ reactive: true });
            this._mouseBox = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 12px;',
            });

            this._mouseIcon = new St.Icon({
                icon_name: 'input-mouse-symbolic',
                icon_size: 18,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._mouseBox.add_child(this._mouseIcon);

            this._mouseTitle = new St.Label({
                text: 'VXE Dragonfly R1+',
                style: 'font-weight: 500; font-size: 13px;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._mouseBox.add_child(this._mouseTitle);

            this._mouseBadge = new St.Label({
                text: '? %',
                style: 'font-weight: 500; padding: 2px 8px; border-radius: 6px; background-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.45);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._mouseBox.add_child(this._mouseBadge);

            this._mouseItem.add_child(this._mouseBox);
            this.menu.addMenuItem(this._mouseItem);

            // 2. Headset item (MCHOSE V9 Turbo) - Single clean row
            this._headsetItem = new PopupMenu.PopupBaseMenuItem({ reactive: true });
            this._headsetBox = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 12px;',
            });

            this._headsetIcon = new St.Icon({
                icon_name: 'audio-headphones-symbolic',
                icon_size: 18,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._headsetBox.add_child(this._headsetIcon);

            this._headsetTitle = new St.Label({
                text: 'MCHOSE V9 Turbo',
                style: 'font-weight: 500; font-size: 13px;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._headsetBox.add_child(this._headsetTitle);

            this._headsetBadge = new St.Label({
                text: '? %',
                style: 'font-weight: 500; padding: 2px 8px; border-radius: 6px; background-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.45);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._headsetBox.add_child(this._headsetBadge);

            this._headsetItem.add_child(this._headsetBox);
            this.menu.addMenuItem(this._headsetItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Footer link: QPatcher Preferences
            const prefsItem = new PopupMenu.PopupMenuItem('QPatcher Settings');
            prefsItem.insert_child_at_index(new St.Icon({
                icon_name: 'emblem-system-symbolic',
                icon_size: 14,
                style: 'margin-right: 8px;',
            }), 0);
            prefsItem.connect('activate', () => {
                this._extension.openPreferences();
            });
            this.menu.addMenuItem(prefsItem);
        }

        startPolling() {
            this.refresh(false);
            const intervalSec = Math.max(10, this._settings?.get_int('battery-poll-interval') || 30);
            if (this._pollTimeoutId) {
                GLib.Source.remove(this._pollTimeoutId);
                this._pollTimeoutId = null;
            }
            this._pollTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, intervalSec, () => {
                this.refresh(false);
                return GLib.SOURCE_CONTINUE;
            });
        }

        stopPolling() {
            if (this._pollTimeoutId) {
                GLib.Source.remove(this._pollTimeoutId);
                this._pollTimeoutId = null;
            }
        }

        async refresh(interactive = false) {
            if (this._isQuerying) return;
            this._isQuerying = true;

            if (interactive) {
                this._animateRefresh();
            }

            if (this._refreshBtn) {
                this._refreshBtn.reactive = false;
                try {
                    this._refreshBtn.ease({
                        opacity: 130,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                } catch (_) {}
            }

            try {
                const scriptPath = `${this._extension.path}/battery_reader.py`;
                const { stdout, stderr } = await execSubprocess(['python3', scriptPath]);
                if (stdout) {
                    const data = JSON.parse(stdout.trim());
                    this._applyData(data, interactive);
                } else if (stderr) {
                    console.error('[QPatcher] Battery reader stderr:', stderr);
                }
            } catch (e) {
                console.error('[QPatcher] Battery refresh error:', e);
            } finally {
                this._isQuerying = false;
                if (this._refreshBtn) {
                    this._refreshBtn.reactive = true;
                    try {
                        this._refreshBtn.ease({
                            opacity: 255,
                            duration: 200,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    } catch (_) {}
                }
            }
        }

        _applyData(data, interactive = false) {
            this._latestData = data;
            const mouse = data?.mouse;
            const headset = data?.headset;
            const accent = this._getAccentColor();

            const activeStyle = `font-weight: 600; padding: 2px 8px; border-radius: 6px; background-color: ${accent}; color: #ffffff;`;
            const offlineStyle = 'font-weight: 500; padding: 2px 8px; border-radius: 6px; background-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.45);';

            // 1. Mouse update: show % if known, else '? %'
            if (mouse && mouse.connected && mouse.battery !== null) {
                this._mouseBadge.text = `${mouse.battery}%`;
                this._mouseBadge.style = activeStyle;
            } else {
                this._mouseBadge.text = '? %';
                this._mouseBadge.style = offlineStyle;
            }

            // 2. Headset update: show % if known, else '? %' (no 'Active' or 'Offline')
            if (headset && headset.connected && headset.battery !== null) {
                this._headsetBadge.text = `${headset.battery}%`;
                this._headsetBadge.style = activeStyle;
            } else {
                this._headsetBadge.text = '? %';
                this._headsetBadge.style = offlineStyle;
            }

            if (interactive) {
                this._flashBadge(this._mouseBadge);
                this._flashBadge(this._headsetBadge);
            }

            // 3. Top bar icon and label
            if (mouse && mouse.connected && mouse.battery !== null) {
                this._icon.icon_name = this._getBatteryIconName(mouse.battery, mouse.charging);
                this._label.text = `${mouse.battery}%`;
            } else if (headset && headset.connected && headset.battery !== null) {
                this._icon.icon_name = this._getBatteryIconName(headset.battery, headset.charging);
                this._label.text = `${headset.battery}%`;
            } else {
                this._icon.icon_name = 'battery-missing-symbolic';
                this._label.text = '';
            }

            this._updatePanelLabelVisibility();
        }

        destroy() {
            this.stopPolling();
            if (this._settingsSig && this._settings) {
                this._settings.disconnect(this._settingsSig);
                this._settingsSig = null;
            }
            if (this._accentSig && this._extension?._interfaceSettings) {
                this._extension._interfaceSettings.disconnect(this._accentSig);
                this._accentSig = null;
            }
            super.destroy();
        }
    }
);
