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
                this._applyData(cached);
            }

            this.menu.connect('open-state-changed', (_menu, isOpen) => {
                if (isOpen) {
                    this.refresh();
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
                    if (this._latestData) {
                        this._applyData(this._latestData);
                    }
                });
            }

            this.startPolling();
        }

        _getAccentColor() {
            return this._extension?._getAccentHex?.() || '#5e6f82';
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

        _buildMenu() {
            this.menu.removeAll();

            // Header: clean title without extra buttons
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
                text: '--',
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
                text: '--',
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
            this.refresh();
            const intervalSec = Math.max(10, this._settings?.get_int('battery-poll-interval') || 30);
            if (this._pollTimeoutId) {
                GLib.Source.remove(this._pollTimeoutId);
                this._pollTimeoutId = null;
            }
            this._pollTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, intervalSec, () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
        }

        stopPolling() {
            if (this._pollTimeoutId) {
                GLib.Source.remove(this._pollTimeoutId);
                this._pollTimeoutId = null;
            }
        }

        async refresh() {
            if (this._isQuerying) return;
            this._isQuerying = true;

            try {
                const scriptPath = `${this._extension.path}/battery_reader.py`;
                const { stdout, stderr } = await execSubprocess(['python3', scriptPath]);
                if (stdout) {
                    const data = JSON.parse(stdout.trim());
                    this._applyData(data);
                } else if (stderr) {
                    console.error('[QPatcher] Battery reader stderr:', stderr);
                }
            } catch (e) {
                console.error('[QPatcher] Battery refresh error:', e);
            } finally {
                this._isQuerying = false;
            }
        }

        _applyData(data) {
            this._latestData = data;
            const mouse = data?.mouse;
            const headset = data?.headset;
            const accent = this._getAccentColor();

            const activeStyle = `font-weight: 600; padding: 2px 8px; border-radius: 6px; background-color: ${accent}; color: #ffffff;`;
            const offlineStyle = 'font-weight: 500; padding: 2px 8px; border-radius: 6px; background-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.45);';

            // 1. Mouse update
            if (mouse && mouse.connected && mouse.battery !== null) {
                const chg = mouse.charging ? ' ⚡' : '';
                this._mouseBadge.text = `${mouse.battery}%${chg}`;
                this._mouseBadge.style = activeStyle;
            } else {
                this._mouseBadge.text = 'Offline';
                this._mouseBadge.style = offlineStyle;
            }

            // 2. Headset update
            if (headset && headset.connected) {
                if (headset.battery !== null) {
                    const chg = headset.charging ? ' ⚡' : '';
                    this._headsetBadge.text = `${headset.battery}%${chg}`;
                    this._headsetBadge.style = activeStyle;
                } else {
                    this._headsetBadge.text = headset.charging ? 'Charging' : 'Active';
                    this._headsetBadge.style = activeStyle;
                }
            } else {
                this._headsetBadge.text = 'Offline';
                this._headsetBadge.style = offlineStyle;
            }

            // 3. Top bar icon and label
            if (mouse && mouse.connected && mouse.battery !== null) {
                this._icon.icon_name = this._getBatteryIconName(mouse.battery, mouse.charging);
                this._label.text = `${mouse.battery}%`;
            } else if (headset && headset.connected && headset.battery !== null) {
                this._icon.icon_name = this._getBatteryIconName(headset.battery, headset.charging);
                this._label.text = `${headset.battery}%`;
            } else if (headset && headset.connected) {
                this._icon.icon_name = 'battery-level-100-symbolic';
                this._label.text = 'Audio';
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
