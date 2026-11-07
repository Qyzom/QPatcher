import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class QPatcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

        // Accent highlight for switch:checked
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
        const prefsCssProvider = new Gtk.CssProvider();
        const updatePrefsStyle = () => {
            const currentAccent = interfaceSettings.get_string('accent-color') || settings.get_string('accent-color') || 'blue';
            const color = accentMap[currentAccent] || '#3584e4';
            const css = `
                switch:checked {
                    background-color: ${color};
                    border-color: ${color};
                }
                switch:checked slider {
                    background-color: #ffffff;
                }
                .palette-chip {
                    min-width: 32px;
                    min-height: 28px;
                    border-radius: 6px;
                    padding: 0;
                    margin: 2px 3px;
                    border: 1px solid rgba(255, 255, 255, 0.25);
                }
                .palette-chip:hover {
                    border: 2px solid #ffffff;
                }
            `;
            try {
                prefsCssProvider.load_from_data(css, -1);
            } catch (e) {}
        };

        try {
            const display = Gdk.Display.get_default();
            if (display) {
                Gtk.StyleContext.add_provider_for_display(
                    display,
                    prefsCssProvider,
                    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
                );
            }
            updatePrefsStyle();
            settings.connect('changed::accent-color', updatePrefsStyle);
            interfaceSettings.connect('changed::accent-color', updatePrefsStyle);
        } catch (e) {}

        const addSwitch = (group, title, subtitle, schemaKey) => {
            const row = new Adw.SwitchRow({
                title: _(title),
                subtitle: subtitle ? _(subtitle) : null,
            });
            group.add(row);
            settings.bind(schemaKey, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        const addOpacitySlider = (group, title, schemaKey) => {
            const row = new Adw.SpinRow({
                title: _(title),
                subtitle: _('Opacity from 0% to 100%'),
                adjustment: new Gtk.Adjustment({
                    lower: 0,
                    upper: 100,
                    step_increment: 5,
                    page_increment: 10,
                    value: settings.get_int(schemaKey),
                }),
            });
            row.connect('notify::value', () => {
                settings.set_int(schemaKey, row.value);
            });
            group.add(row);
            return row;
        };

        const addStyleCombo = (group, title, schemaKey) => {
            const model = new Gtk.StringList();
            model.append(_('Default'));
            model.append(_('Theme Color / Transparency'));

            const styles = ['default', 'theme-grey'];
            const current = settings.get_string(schemaKey);
            const row = new Adw.ComboRow({
                title: _(title),
                model: model,
                selected: Math.max(0, styles.indexOf(current)),
            });
            row.connect('notify::selected', () => {
                settings.set_string(schemaKey, styles[row.selected]);
            });
            group.add(row);
            return row;
        };

        const getMonitorNames = () => {
            const list = [];
            try {
                const homeDir = GLib.get_home_dir();
                const xmlPath = `${homeDir}/.config/monitors.xml`;
                const file = Gio.File.new_for_path(xmlPath);
                if (file.query_exists(null)) {
                    const [, content] = GLib.file_get_contents(xmlPath);
                    const text = new TextDecoder('utf-8').decode(content);
                    const regex = /<logicalmonitor>[\s\S]*?<connector>([^<]+)<\/connector>([\s\S]*?)<\/logicalmonitor>/g;
                    let match;
                    let idx = 1;
                    while ((match = regex.exec(text)) !== null) {
                        const conn = match[1];
                        const isPrimary = match[2].includes('<primary>yes</primary>');
                        list.push(`Monitor ${idx} (${conn}${isPrimary ? ', Primary' : ''})`);
                        idx++;
                    }
                }
            } catch (_) {}

            if (list.length === 0) {
                try {
                    const display = Gdk.Display.get_default();
                    const monitors = display?.get_monitors();
                    const count = monitors ? monitors.get_n_items() : 0;
                    for (let i = 0; i < count; i++) {
                        list.push(`Monitor ${i + 1}`);
                    }
                } catch (_) {}
            }
            return list;
        };


        // ==========================================
        // NAVIGATION SIDEBAR (VERTICAL NAVIGATION)
        // ==========================================
        window.set_default_size(960, 680);

        const splitView = new Adw.NavigationSplitView({
            min_sidebar_width: 230,
            max_sidebar_width: 290,
        });

        // Sidebar panel
        const sidebarPage = new Adw.NavigationPage({
            title: 'QPatcher',
            tag: 'sidebar',
        });
        const sidebarToolbar = new Adw.ToolbarView();
        const sidebarHeader = new Adw.HeaderBar();
        sidebarToolbar.add_top_bar(sidebarHeader);

        const sidebarListBox = new Gtk.ListBox({
            css_classes: ['navigation-sidebar'],
            selection_mode: Gtk.SelectionMode.SINGLE,
        });
        const sidebarScroll = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        });
        sidebarScroll.set_child(sidebarListBox);
        sidebarToolbar.set_content(sidebarScroll);
        sidebarPage.set_child(sidebarToolbar);
        splitView.set_sidebar(sidebarPage);

        // Main content area
        const contentPage = new Adw.NavigationPage({
            title: _('Top Bar'),
            tag: 'content',
        });
        const contentToolbar = new Adw.ToolbarView();
        const contentHeader = new Adw.HeaderBar();
        contentToolbar.add_top_bar(contentHeader);

        const stack = new Adw.ViewStack();
        contentToolbar.set_content(stack);
        contentPage.set_child(contentToolbar);
        splitView.set_content(contentPage);

        window.set_content(splitView);

        const addSection = (tag, title, iconName, page) => {
            stack.add_named(page, tag);

            const row = new Adw.ActionRow({
                title: _(title),
                activatable: true,
            });
            const img = new Gtk.Image({
                icon_name: iconName,
            });
            row.add_prefix(img);
            row._tag = tag;
            sidebarListBox.append(row);
            return row;
        };

        // ==========================================
        // 1. TAB: TOP BAR
        // ==========================================
        const pageTopbar = new Adw.PreferencesPage({
            title: _('Top Bar'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        addSection('topbar', 'Top Bar', 'preferences-desktop-display-symbolic', pageTopbar);

        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Top Bar Monitor'),
            description: _('Select physical display for the top panel'),
        });
        pageTopbar.add(monitorGroup);

        const monitorModel = new Gtk.StringList();
        monitorModel.append(_('Primary Monitor'));
        const detectedMons = getMonitorNames();
        detectedMons.forEach(m => monitorModel.append(m));

        const monitorRow = new Adw.ComboRow({
            title: _('Panel Display'),
            model: monitorModel,
            selected: Math.min(settings.get_int('topbar-monitor'), monitorModel.get_n_items() - 1),
        });
        monitorRow.connect('notify::selected', () => {
            settings.set_int('topbar-monitor', monitorRow.selected);
        });
        monitorGroup.add(monitorRow);

        const langClockGroup = new Adw.PreferencesGroup({
            title: _('Language Indicator and Clock'),
        });
        pageTopbar.add(langClockGroup);

        addSwitch(langClockGroup, 'Uppercase Layout (RU)', 'Display language code in uppercase (never resets)', 'keyboard-uppercase');
        addSwitch(langClockGroup, 'Show Day of Week', 'Add abbreviated day of the week to clock', 'clock-show-weekday');
        addSwitch(langClockGroup, 'Show Seconds', 'Show seconds in top bar clock', 'clock-show-seconds');

        const topbarColorGroup = new Adw.PreferencesGroup({
            title: _('Top Bar Background and Style'),
        });
        pageTopbar.add(topbarColorGroup);

        addStyleCombo(topbarColorGroup, 'Background Style', 'topbar-style');
        addOpacitySlider(topbarColorGroup, 'Top Bar Opacity', 'topbar-opacity');
        addSwitch(topbarColorGroup, 'Transparent in Overview', 'Smoothly fade panel background when entering overview', 'topbar-transparent-in-overview');

        const topbarVisibilityGroup = new Adw.PreferencesGroup({
            title: _('Panel Elements Visibility'),
        });
        pageTopbar.add(topbarVisibilityGroup);

        addSwitch(topbarVisibilityGroup, 'Top Panel', null, 'panel-visibility');
        addSwitch(topbarVisibilityGroup, 'Activities Button', null, 'activities-button');
        addSwitch(topbarVisibilityGroup, 'Clock and Date', null, 'clock-menu');
        addSwitch(topbarVisibilityGroup, 'Accessibility Menu', null, 'accessibility-menu');
        addSwitch(topbarVisibilityGroup, 'Quick Settings Menu', null, 'quicksettings-button');

        const peripheralBatteryGroup = new Adw.PreferencesGroup({
            title: _('Peripheral Battery Monitor'),
            description: _('Monitor battery levels for VXE Dragonfly mice and MCHOSE headsets'),
        });
        pageTopbar.add(peripheralBatteryGroup);

        addSwitch(peripheralBatteryGroup, 'Peripheral Battery Indicator', 'Display battery icon and popup in the top bar', 'battery-indicator-enabled');
        addSwitch(peripheralBatteryGroup, 'Show Percentage on Panel', 'Show numeric percentage text next to top bar icon', 'battery-show-percentage-in-panel');


        // ==========================================
        // 2. TAB: DASH & DOCK
        // ==========================================
        const pageDock = new Adw.PreferencesPage({
            title: _('Dock'),
            icon_name: 'view-app-grid-symbolic',
        });
        addSection('dock', 'Dock', 'view-app-grid-symbolic', pageDock);

        const dockFeaturesGroup = new Adw.PreferencesGroup({
            title: _('Dock Elements and Behavior'),
            description: _('Fine-tune Dash, desktop pinning, and animations'),
        });
        pageDock.add(dockFeaturesGroup);

        const rowAlwaysVisible = addSwitch(dockFeaturesGroup, 'Show Dock on Desktop', 'Pin dock to desktop and reserve desktop space', 'dock-always-visible');
        const rowIntellihide = addSwitch(dockFeaturesGroup, 'Intellihide', 'Hide dock when overlapped by any window', 'dock-intellihide');
        rowIntellihide.sensitive = rowAlwaysVisible.active;
        rowAlwaysVisible.connect('notify::active', () => {
            rowIntellihide.sensitive = rowAlwaysVisible.active;
        });

        addSwitch(dockFeaturesGroup, 'Icon Hover Magnification (macOS Style)', 'Smoothly magnify and lift icons on mouse hover', 'dock-magnification');
        addSwitch(dockFeaturesGroup, 'Notification Badge Accent Color', 'Color unread notification badges with accent color instead of red', 'dock-notification-badge-accent');
        const rowBar = addSwitch(dockFeaturesGroup, 'Single Running Indicator Bar', 'Show a single accent bar under active apps instead of dots', 'dock-running-indicator-bar');
        addSwitch(dockFeaturesGroup, 'Show Removable Media and Drives', 'Show mounted USB flash drives and storage devices in dock', 'dock-show-mounts');
        addSwitch(dockFeaturesGroup, 'Show Trash Bin', 'Show Trash bin icon in dock', 'dock-show-trash');
        addSwitch(dockFeaturesGroup, 'Hide Notification Badges', 'Do not display badge with notification count on icons', 'dock-notification-badge-hide');
        addSwitch(dockFeaturesGroup, 'Hide Icon Tooltips', 'Disable hover tooltip labels on icons', 'dock-tooltips-hide');
        addSwitch(dockFeaturesGroup, 'Hide Separator', 'Hide divider line between favorites and running apps', 'dock-separator-hide');
        addSwitch(dockFeaturesGroup, 'Hide Applications Button', 'Hide app grid icon (nine dots)', 'dock-show-apps-hide');
        const rowHideDots = addSwitch(dockFeaturesGroup, 'Hide Running Indicators', 'Completely hide running indicators under apps', 'dock-running-dots-hide');

        rowBar.sensitive = !rowHideDots.active;
        rowHideDots.connect('notify::active', () => {
            rowBar.sensitive = !rowHideDots.active;
        });

        const dockSizeGroup = new Adw.PreferencesGroup({
            title: _('Dock Icon Size'),
        });
        pageDock.add(dockSizeGroup);

        const iconSizeRow = new Adw.SpinRow({
            title: _('Icon Size (px)'),
            adjustment: new Gtk.Adjustment({ lower: 24, upper: 96, step_increment: 4, page_increment: 8, value: settings.get_int('dock-icon-size') }),
        });
        iconSizeRow.connect('notify::value', () => {
            settings.set_int('dock-icon-size', iconSizeRow.value);
        });
        dockSizeGroup.add(iconSizeRow);

        const dockStyleGroup = new Adw.PreferencesGroup({
            title: _('Dock Background Style'),
        });
        pageDock.add(dockStyleGroup);

        addStyleCombo(dockStyleGroup, 'Dock Background Style', 'dock-style');
        addOpacitySlider(dockStyleGroup, 'Dock Opacity', 'dock-opacity');

        const dockMonitorGroup = new Adw.PreferencesGroup({
            title: _('Dock Display and Position'),
            description: _('Select display where the dock is located'),
        });
        pageDock.add(dockMonitorGroup);

        const dockMonitorModel = new Gtk.StringList();
        dockMonitorModel.append(_('Follow Top Bar'));
        detectedMons.forEach(m => dockMonitorModel.append(m));
        dockMonitorModel.append(_('On All Screens'));

        const dockMonitorRow = new Adw.ComboRow({
            title: _('Dock Position'),
            model: dockMonitorModel,
            selected: Math.min(settings.get_int('dock-monitor'), dockMonitorModel.get_n_items() - 1),
        });
        dockMonitorRow.connect('notify::selected', () => {
            settings.set_int('dock-monitor', dockMonitorRow.selected);
        });
        dockMonitorGroup.add(dockMonitorRow);


        // ==========================================
        // 3. TAB: OVERVIEW & WINDOWS
        // ==========================================
        const pageOverview = new Adw.PreferencesPage({
            title: _('Overview and Windows'),
            icon_name: 'view-grid-symbolic',
        });
        addSection('overview', 'Overview and Windows', 'view-grid-symbolic', pageOverview);

        const overviewStyleGroup = new Adw.PreferencesGroup({
            title: _('Overview Background'),
            description: _('Configure overview mode background'),
        });
        pageOverview.add(overviewStyleGroup);

        addStyleCombo(overviewStyleGroup, 'Overview Background Style', 'overview-style');
        addOpacitySlider(overviewStyleGroup, 'Overview Background Opacity', 'overview-opacity');

        const overviewElementsGroup = new Adw.PreferencesGroup({
            title: _('Overview and Window Elements'),
        });
        pageOverview.add(overviewElementsGroup);

        addSwitch(overviewElementsGroup, 'Hide Window Close Button (X)', null, 'overview-window-close-button-hide');
        addSwitch(overviewElementsGroup, 'Hide Window App Icon', null, 'overview-window-icon-hide');
        addSwitch(overviewElementsGroup, 'Hide Window Title', 'Completely hide title without empty black frames', 'overview-window-title-hide');
        addSwitch(overviewElementsGroup, 'Hide Search Bar', null, 'overview-search-hide');
        addSwitch(overviewElementsGroup, 'Hide Workspace Thumbnails', null, 'overview-workspace-switcher-hide');


        // ==========================================
        // 4. TAB: NOTIFICATIONS & OSD
        // ==========================================
        const pageNotifications = new Adw.PreferencesPage({
            title: _('Notifications and OSD'),
            icon_name: 'preferences-system-notifications-symbolic',
        });
        addSection('notifications', 'Notifications and OSD', 'preferences-system-notifications-symbolic', pageNotifications);

        const notifPositionGroup = new Adw.PreferencesGroup({
            title: _('Notification Popups Position'),
            description: _('Select monitor and horizontal alignment for banners'),
        });
        pageNotifications.add(notifPositionGroup);

        const notifMonitorModel = new Gtk.StringList();
        notifMonitorModel.append(_('Primary Monitor'));
        detectedMons.forEach(m => notifMonitorModel.append(m));

        const notifMonitorRow = new Adw.ComboRow({
            title: _('Monitor for Banners'),
            model: notifMonitorModel,
            selected: Math.min(settings.get_int('notification-monitor'), notifMonitorModel.get_n_items() - 1),
        });
        notifMonitorRow.connect('notify::selected', () => {
            settings.set_int('notification-monitor', notifMonitorRow.selected);
        });
        notifPositionGroup.add(notifMonitorRow);

        const hAlignModel = new Gtk.StringList();
        hAlignModel.append(_('Center'));
        hAlignModel.append(_('Left'));
        hAlignModel.append(_('Right'));
        const hAlignValues = ['center', 'left', 'right'];

        const hAlignRow = new Adw.ComboRow({
            title: _('Horizontal Alignment'),
            model: hAlignModel,
            selected: Math.max(0, hAlignValues.indexOf(settings.get_string('notification-horizontal-alignment'))),
        });
        hAlignRow.connect('notify::selected', () => {
            settings.set_string('notification-horizontal-alignment', hAlignValues[hAlignRow.selected]);
        });
        notifPositionGroup.add(hAlignRow);

        const notifStyleGroup = new Adw.PreferencesGroup({
            title: _('Notification Banner Style'),
        });
        pageNotifications.add(notifStyleGroup);

        addStyleCombo(notifStyleGroup, 'Banner Background Style', 'notification-style');
        addOpacitySlider(notifStyleGroup, 'Banner Opacity', 'notification-opacity');

        const notifOptionsGroup = new Adw.PreferencesGroup({
            title: _('Additional Banner Options'),
        });
        pageNotifications.add(notifOptionsGroup);

        addSwitch(notifOptionsGroup, 'Hide Banner Close Button (X)', null, 'notification-close-button-hide');
        addSwitch(notifOptionsGroup, 'Hide Top Bar Notification Icon', null, 'panel-notification-icon-hide');

        const timeoutRow = new Adw.SpinRow({
            title: _('Banner Timeout (seconds)'),
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 20, step_increment: 1, page_increment: 2, value: settings.get_int('notification-timeout') }),
        });
        timeoutRow.connect('notify::value', () => {
            settings.set_int('notification-timeout', timeoutRow.value);
        });
        notifOptionsGroup.add(timeoutRow);

        const osdGroup = new Adw.PreferencesGroup({
            title: _('Volume and Brightness Indicators (OSD)'),
            description: _('On-screen displays when adjusting volume with encoder, keys, or brightness'),
        });
        pageNotifications.add(osdGroup);

        const osdMonitorModel = new Gtk.StringList();
        osdMonitorModel.append(_('Primary Monitor'));
        osdMonitorModel.append(_('On All Screens'));
        const osdMonitorValues = [0, -1];

        detectedMons.forEach((m, idx) => {
            osdMonitorModel.append(m);
            osdMonitorValues.push(idx + 1);
        });

        const currentOsdVal = settings.get_int('osd-monitor');
        const osdSelectedIdx = osdMonitorValues.indexOf(currentOsdVal);

        const osdMonitorRow = new Adw.ComboRow({
            title: _('Monitor for OSD'),
            model: osdMonitorModel,
            selected: osdSelectedIdx >= 0 ? osdSelectedIdx : 0,
        });
        osdMonitorRow.connect('notify::selected', () => {
            const val = osdMonitorValues[osdMonitorRow.selected] ?? 0;
            settings.set_int('osd-monitor', val);
        });
        osdGroup.add(osdMonitorRow);


        // ==========================================
        // 5. TAB: CALENDAR & CLOCK
        // ==========================================
        const pageDateMenu = new Adw.PreferencesPage({
            title: _('Calendar and Clock'),
            icon_name: 'x-office-calendar-symbolic',
        });
        addSection('datemenu', 'Calendar and Clock', 'x-office-calendar-symbolic', pageDateMenu);

        const calendarGroup = new Adw.PreferencesGroup({
            title: _('Calendar and Menu Sections'),
            description: _('Configure clock dropdown menu elements'),
        });
        pageDateMenu.add(calendarGroup);

        const rowHideRight = addSwitch(calendarGroup, 'Hide Right Column (Calendar and Events)', 'Completely hide right column with all widgets', 'datemenu-calendar-hide');
        addSwitch(calendarGroup, 'Compact Mode When No Notifications', 'Hide "No notifications" text and center the icon', 'datemenu-compact-empty');
        const rowWeather = addSwitch(calendarGroup, 'Hide Weather Section', null, 'datemenu-weather-hide');
        const rowClocks = addSwitch(calendarGroup, 'Hide World Clocks', null, 'datemenu-world-clocks-hide');
        const rowEvents = addSwitch(calendarGroup, 'Hide Events', null, 'datemenu-events-hide');

        const updateRightSubRows = () => {
            const isRightHidden = rowHideRight.active;
            rowWeather.sensitive = !isRightHidden;
            rowClocks.sensitive = !isRightHidden;
            rowEvents.sensitive = !isRightHidden;
        };
        updateRightSubRows();
        rowHideRight.connect('notify::active', updateRightSubRows);

        const dateMenuStyleGroup = new Adw.PreferencesGroup({
            title: _('Notification Curtain Style and Background'),
        });
        pageDateMenu.add(dateMenuStyleGroup);

        addStyleCombo(dateMenuStyleGroup, 'Menu Background Style', 'datemenu-style');
        addOpacitySlider(dateMenuStyleGroup, 'Menu Background Opacity', 'datemenu-opacity');


        // ==========================================
        // 6. TAB: QUICK SETTINGS
        // ==========================================
        const pageQuickSettings = new Adw.PreferencesPage({
            title: _('Quick Settings'),
            icon_name: 'emblem-system-symbolic',
        });
        addSection('quicksettings', 'Quick Settings', 'emblem-system-symbolic', pageQuickSettings);

        const qsLayoutGroup = new Adw.PreferencesGroup({
            title: _('Tile Layout'),
        });
        pageQuickSettings.add(qsLayoutGroup);

        addSwitch(qsLayoutGroup, 'Stretch Odd Tile', 'Stretch the last single tile across 2 columns', 'quicksettings-full-width-toggle');
        addSwitch(qsLayoutGroup, 'Full-Width Background Apps', 'Display background apps as a full-width bottom row instead of a grid tile', 'quicksettings-background-apps-full-width');

        const qsButtonsGroup = new Adw.PreferencesGroup({
            title: _('Round System Buttons'),
            description: _('Directly hide system action buttons in Quick Settings'),
        });
        pageQuickSettings.add(qsButtonsGroup);

        addSwitch(qsButtonsGroup, 'Hide Power / Log Out Button', null, 'qs-power-hide');
        addSwitch(qsButtonsGroup, 'Hide Screenshot Button', null, 'qs-screenshot-hide');
        addSwitch(qsButtonsGroup, 'Hide Settings Button (Gear)', null, 'qs-settings-hide');
        addSwitch(qsButtonsGroup, 'Hide Lock Screen Button', null, 'qs-lock-hide');

        const qsStyleGroup = new Adw.PreferencesGroup({
            title: _('Quick Settings Menu Style'),
        });
        pageQuickSettings.add(qsStyleGroup);

        addStyleCombo(qsStyleGroup, 'Background Style', 'quicksettings-style');
        addOpacitySlider(qsStyleGroup, 'Quick Settings Opacity', 'quicksettings-opacity');


        // ==========================================
        // 7. TAB: SCREENSHOTS
        // ==========================================
        const pageScreenshots = new Adw.PreferencesPage({
            title: _('Screenshots'),
            icon_name: 'applets-screenshooter-symbolic',
        });
        addSection('screenshots', 'Screenshots', 'applets-screenshooter-symbolic', pageScreenshots);

        const screenshotNamingGroup = new Adw.PreferencesGroup({
            title: _('File Naming and Saving'),
            description: _('File naming pattern and screenshot storage options'),
        });
        pageScreenshots.add(screenshotNamingGroup);

        const namingModel = new Gtk.StringList();
        namingModel.append(_('Timestamp'));
        namingModel.append(_('Random Number'));
        namingModel.append(_('Default'));
        const namingValues = ['date', 'random', 'default'];

        const namingRow = new Adw.ComboRow({
            title: _('File Naming Format'),
            model: namingModel,
            selected: Math.max(0, namingValues.indexOf(settings.get_string('screenshot-filename-format'))),
        });
        namingRow.connect('notify::selected', () => {
            settings.set_string('screenshot-filename-format', namingValues[namingRow.selected]);
        });
        screenshotNamingGroup.add(namingRow);

        addSwitch(screenshotNamingGroup, 'Copy to Clipboard Only', 'Copy screenshot to clipboard without saving file to disk', 'screenshot-clipboard-only');

        const saveLocModel = new Gtk.StringList();
        saveLocModel.append(_('Screenshots Subfolder'));
        saveLocModel.append(_('Pictures Folder'));
        const saveLocValues = ['subfolder', 'pictures'];

        const saveLocRow = new Adw.ComboRow({
            title: _('Save Destination Folder'),
            model: saveLocModel,
            selected: Math.max(0, saveLocValues.indexOf(settings.get_string('screenshot-save-location'))),
        });
        saveLocRow.connect('notify::selected', () => {
            settings.set_string('screenshot-save-location', saveLocValues[saveLocRow.selected]);
        });
        screenshotNamingGroup.add(saveLocRow);

        const screenshotSoundGroup = new Adw.PreferencesGroup({
            title: _('Shutter Sound'),
            description: _('Select audio effect when taking screenshot'),
        });
        pageScreenshots.add(screenshotSoundGroup);

        const soundModel = new Gtk.StringList();
        soundModel.append(_('Camera Shutter'));
        soundModel.append(_('Soft Click'));
        soundModel.append(_('Silent'));
        const soundValues = ['default', 'bubble', 'disabled'];

        const soundRow = new Adw.ComboRow({
            title: _('Shutter Sound'),
            model: soundModel,
            selected: Math.max(0, soundValues.indexOf(settings.get_string('screenshot-sound'))),
        });
        soundRow.connect('notify::selected', () => {
            settings.set_string('screenshot-sound', soundValues[soundRow.selected]);
        });
        screenshotSoundGroup.add(soundRow);

        const screenshotUiGroup = new Adw.PreferencesGroup({
            title: _('Interface and Capture Speed'),
            description: _('Screenshot overlay behavior on PrintScreen'),
        });
        pageScreenshots.add(screenshotUiGroup);

        addSwitch(screenshotUiGroup, 'Show Mouse Cursor', 'Display mouse cursor on screenshots by default', 'screenshot-show-pointer');
        addSwitch(screenshotUiGroup, 'Quick Capture', 'Instant capture upon drag release without pressing Enter', 'screenshot-quick-capture');
        addSwitch(screenshotUiGroup, 'Reset Selection Area', 'Do not keep default selection box when opening screenshot menu', 'screenshot-clear-selection');
        addSwitch(screenshotUiGroup, 'Hide Bottom Tool Panel', 'Hide Area/Screen/Window/Video toolbar for a clean screen', 'screenshot-hide-panel');


        // ==========================================
        // 8. TAB: CLIPBOARD & EMOJI
        // ==========================================
        const pageClipboard = new Adw.PreferencesPage({
            title: _('Clipboard and Emoji'),
            icon_name: 'edit-paste-symbolic',
        });
        addSection('clipboard', 'Clipboard and Emoji', 'edit-paste-symbolic', pageClipboard);

        const clipboardGroup = new Adw.PreferencesGroup({
            title: _('Clipboard and Emoji'),
            description: _('Integrated clipboard history manager and emoji selector'),
        });
        pageClipboard.add(clipboardGroup);

        addSwitch(clipboardGroup, 'Enable Clipboard and Emoji', 'Store clipboard history and provide popup selector', 'clipboard-enable');
        addSwitch(clipboardGroup, 'Top Bar Icon', 'Display clipboard icon on the top panel near date menu', 'clipboard-topbar-icon');
        addSwitch(clipboardGroup, 'Auto-Paste on Selection', 'Automatically paste selected item or emoji into the active window', 'clipboard-auto-paste');
        addSwitch(clipboardGroup, 'Clear History on Reboot', 'Clear unpinned history items on system start, preserving pinned items', 'clipboard-clear-on-reboot');

        const limitRow = new Adw.SpinRow({
            title: _('History Limit'),
            subtitle: _('Maximum entries in history (from 10 to 500)'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 500,
                step_increment: 10,
                page_increment: 50,
                value: settings.get_int('clipboard-history-limit'),
            }),
        });
        limitRow.connect('notify::value', () => {
            settings.set_int('clipboard-history-limit', limitRow.value);
        });
        clipboardGroup.add(limitRow);

        const clipboardShortcutsGroup = new Adw.PreferencesGroup({
            title: _('Shortcuts and External Launch'),
            description: _('Global hotkeys and commands for custom keybindings'),
        });
        pageClipboard.add(clipboardShortcutsGroup);

        function createShortcutRow(title, subtitle, schemaKey, defaultKeys) {
            const row = new Adw.ActionRow({
                title: title,
                subtitle: subtitle,
            });

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 8,
                valign: Gtk.Align.CENTER,
            });

            const keysBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER,
            });
            box.append(keysBox);

            function updateDisplay() {
                let child = keysBox.get_first_child();
                while (child) {
                    const next = child.get_next_sibling();
                    keysBox.remove(child);
                    child = next;
                }

                const keys = settings.get_strv(schemaKey);
                if (!keys || keys.length === 0) {
                    keysBox.append(new Gtk.Label({
                        label: _('Disabled'),
                        css_classes: ['dim-label'],
                    }));
                } else {
                    for (const k of keys) {
                        const sc = new Gtk.ShortcutLabel({
                            accelerator: k,
                            valign: Gtk.Align.CENTER,
                        });
                        keysBox.append(sc);
                    }
                }
            }

            updateDisplay();
            settings.connect(`changed::${schemaKey}`, updateDisplay);

            const resetBtn = new Gtk.Button({
                icon_name: 'edit-undo-symbolic',
                valign: Gtk.Align.CENTER,
                has_frame: false,
                tooltip_text: _('Reset to default'),
            });
            resetBtn.connect('clicked', () => {
                settings.set_strv(schemaKey, defaultKeys);
            });
            box.append(resetBtn);

            row.add_suffix(box);
            return row;
        }

        clipboardShortcutsGroup.add(createShortcutRow(
            _('Clipboard History Shortcut'),
            _('Global GNOME Shell shortcut (active across all apps)'),
            'clipboard-shortcut',
            ['<Super>v']
        ));

        clipboardShortcutsGroup.add(createShortcutRow(
            _('Emoji Picker Shortcut'),
            _('Global GNOME Shell shortcut (active across all apps)'),
            'emoji-shortcut',
            ['<Super>period']
        ));

        // Command for scripts / custom shortcuts in GNOME Settings
        function createCommandRow(title, subtitle, cmdText) {
            const row = new Adw.ActionRow({
                title: title,
                subtitle: subtitle,
            });
            const btn = new Gtk.Button({
                label: _('Copy'),
                valign: Gtk.Align.CENTER,
                css_classes: ['suggested-action'],
            });
            btn.connect('clicked', () => {
                const clipboard = Gdk.Display.get_default()?.get_clipboard();
                clipboard?.set(cmdText);
                btn.label = _('Copied!');
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                    btn.label = _('Copy');
                    return GLib.SOURCE_REMOVE;
                });
            });
            row.add_suffix(btn);
            return row;
        }

        clipboardShortcutsGroup.add(createCommandRow(
            _('Clipboard Open Command'),
            'qpatcher-clipboard',
            'qpatcher-clipboard'
        ));

        clipboardShortcutsGroup.add(createCommandRow(
            _('Emoji Picker Open Command'),
            'qpatcher-emoji',
            'qpatcher-emoji'
        ));

        clipboardShortcutsGroup.add(createCommandRow(
            _('Direct D-Bus Call (without PATH)'),
            _('gdbus call --session --dest org.gnome.Shell ...'),
            `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/QPatcher --method org.gnome.Shell.Extensions.QPatcher.OpenClipboard 'clipboard'`
        ));


        // ==========================================
        // 9. TAB: APPEARANCE & SYSTEM
        // ==========================================
        const pageOther = new Adw.PreferencesPage({
            title: _('Appearance and System'),
            icon_name: 'preferences-other-symbolic',
        });
        addSection('other', 'Appearance and System', 'preferences-other-symbolic', pageOther);

        const themeColorGroup = new Adw.PreferencesGroup({
            title: _('Unified Theme Color'),
            description: _('Base background color for all panels, menus, and dialogs'),
        });
        pageOther.add(themeColorGroup);

        addSwitch(themeColorGroup, 'Recolor All Menus and Dialogs', 'Apply unified theme color to context menus, language popups, and dialogs', 'recolor-all-menus-and-dialogs');
        addStyleCombo(themeColorGroup, 'Menus and Dialogs Style', 'menus-dialogs-style');

        let curColor = (settings.get_string('theme-color') || '').trim();
        if (!curColor.startsWith('#')) curColor = '#232326';
        const paletteActionRow = new Adw.ActionRow({
            title: _('Curated Dark and Neutral Presets'),
            subtitle: _(`Current color: ${curColor}`),
        });
        themeColorGroup.add(paletteActionRow);

        const paletteGrid = new Gtk.FlowBox({
            valign: Gtk.Align.CENTER,
            selection_mode: Gtk.SelectionMode.NONE,
            max_children_per_line: 9,
            min_children_per_line: 6,
            row_spacing: 6,
            column_spacing: 6,
            homogeneous: true,
        });
        paletteActionRow.add_suffix(paletteGrid);

        const presets = [
            { name: 'Obsidian Black', hex: '#18181b' },
            { name: 'Midnight', hex: '#121214' },
            { name: 'Catppuccin Mocha', hex: '#1e1e2e' },
            { name: 'Catppuccin Macchiato', hex: '#24273a' },
            { name: 'Tokyo Night', hex: '#1a1b26' },
            { name: 'Nord Polar', hex: '#2e3440' },
            { name: 'Nord Frost', hex: '#3b4252' },
            { name: 'Gruvbox Dark', hex: '#282828' },
            { name: 'Charcoal Dark', hex: '#232326' },
            { name: 'Midnight Navy', hex: '#1b2230' },
            { name: 'Deep Denim', hex: '#223249' },
            { name: 'Slate Blue', hex: '#2b2d42' },
            { name: 'Cool Grey', hex: '#3c3f4a' },
            { name: 'Warm Taupe', hex: '#322e2b' },
            { name: 'Deep Espresso', hex: '#262427' },
            { name: 'Dark Ochre', hex: '#2d2620' },
            { name: 'Zinc Dark', hex: '#363238' },
            { name: 'Slate Steel', hex: '#45475a' },
        ];

        presets.forEach(p => {
            const btn = new Gtk.Button({
                tooltip_text: `${p.name} (${p.hex})`,
                css_classes: ['palette-chip'],
            });
            const chipProvider = new Gtk.CssProvider();
            chipProvider.load_from_data(`button { background-color: ${p.hex}; min-width: 28px; min-height: 28px; border-radius: 999px; }`, -1);
            btn.get_style_context().add_provider(chipProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            btn.connect('clicked', () => {
                settings.set_string('theme-color', p.hex);
                settings.set_string('theme-card-color', '');
                paletteActionRow.subtitle = _(`Current color: ${p.name} (${p.hex})`);
            });
            paletteGrid.append(btn);
        });

        const accentGroup = new Adw.PreferencesGroup({
            title: _('System Accent Color (GNOME Native)'),
            description: _('Official system accent color palette'),
        });
        pageOther.add(accentGroup);

        const accentNames = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];
        const accentLabels = [
            _('Blue'),
            _('Teal'),
            _('Green'),
            _('Yellow'),
            _('Orange'),
            _('Red'),
            _('Pink'),
            _('Purple'),
            _('Slate'),
        ];

        const accentModel = new Gtk.StringList();
        accentLabels.forEach(l => accentModel.append(l));

        const currentAccent = interfaceSettings.get_string('accent-color') || 'blue';
        const accentRow = new Adw.ComboRow({
            title: _('Accent Color'),
            model: accentModel,
            selected: Math.max(0, accentNames.indexOf(currentAccent)),
        });
        accentRow.connect('notify::selected', () => {
            const chosen = accentNames[accentRow.selected];
            try {
                interfaceSettings.set_string('accent-color', chosen);
            } catch (e) {}
            settings.set_string('accent-color', chosen);
            updatePrefsStyle();
        });
        accentGroup.add(accentRow);

        const systemThemeGroup = new Adw.PreferencesGroup({
            title: _('Global Appearance Themes'),
            description: _('Fast system color scheme switching'),
        });
        pageOther.add(systemThemeGroup);

        addSwitch(systemThemeGroup, 'Dark Style', 'Use system dark style', 'dark-mode');

        const lockGroup = new Adw.PreferencesGroup({
            title: _('Lock Screen and Login'),
            description: _('Lock screen and authorization behavior'),
        });
        pageOther.add(lockGroup);

        addSwitch(lockGroup, 'Patch Top Bar and Styling on Lock Screen', 'Moves top bar to chosen monitor and preserves uppercase layout and styles', 'lockscreen-topbar-enable');
        addSwitch(lockGroup, 'Direct Password Prompt (Skip Clock Curtain)', 'Automatically bypass lock screen curtain and focus password field', 'lockscreen-auto-focus-password');
        addSwitch(lockGroup, 'Keep Monitors Awake on Lock (Win+L)', 'Keeps lock screen with clock and wallpaper awake without turning off displays', 'lockscreen-prevent-blank');
        addSwitch(lockGroup, 'Lock Screen on Auto-login (Boot Lock)', 'If GDM auto-login is enabled, immediately shows lock screen on system boot', 'autologin-lock-on-boot');

        // Handle sidebar section switching
        sidebarListBox.connect('row-selected', (_box, row) => {
            if (row && row._tag) {
                stack.set_visible_child_name(row._tag);
                contentPage.set_title(row.get_title());
            }
        });

        const firstRow = sidebarListBox.get_row_at_index(0);
        if (firstRow) {
            sidebarListBox.select_row(firstRow);
        }
    }
}
