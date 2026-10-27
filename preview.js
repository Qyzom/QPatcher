#!/usr/bin/env gjs

import Gtk from "gi://Gtk?version=4.0";
import Adw from "gi://Adw?version=1";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk?version=4.0";

const _ = s => s;

const app = new Adw.Application({
    application_id: "org.gnome.shell.extensions.qpatcher.preview"
});

app.connect("activate", () => {
    const window = new Adw.PreferencesWindow({ application: app });
    window.set_title("QPatcher — Центр настройки рабочего стола");

    const settings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.qpatcher" });
    const interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });


        // Акцентная подсветка переключателей switch:checked
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
                subtitle: _('Непрозрачность от 0% до 100%'),
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
            model.append(_('По умолчанию'));
            model.append(_('Цвет темы / Прозрачность'));

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
                        list.push(`Монитор ${idx} (${conn}${isPrimary ? ', Основной' : ''})`);
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
                        list.push(`Монитор ${i + 1}`);
                    }
                } catch (_) {}
            }
            return list;
        };


        // ==========================================
        // НАВИГАЦИОННЫЙ САЙДБАР (VERTICAL NAVIGATION)
        // ==========================================
        window.set_default_size(960, 680);

        const splitView = new Adw.NavigationSplitView({
            min_sidebar_width: 230,
            max_sidebar_width: 290,
        });

        // Боковая панель (сайдбар)
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

        // Основная область контента
        const contentPage = new Adw.NavigationPage({
            title: _('Топбар'),
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
        // 1. ВКЛАДКА: ТОПБАР
        // ==========================================
        const pageTopbar = new Adw.PreferencesPage({
            title: _('Топбар'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        addSection('topbar', 'Топбар', 'preferences-desktop-display-symbolic', pageTopbar);

        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Монитор топбара'),
            description: _('Выбор физического дисплея для верхней панели'),
        });
        pageTopbar.add(monitorGroup);

        const monitorModel = new Gtk.StringList();
        monitorModel.append(_('Основной экран'));
        const detectedMons = getMonitorNames();
        detectedMons.forEach(m => monitorModel.append(m));

        const monitorRow = new Adw.ComboRow({
            title: _('Дисплей для панели'),
            model: monitorModel,
            selected: Math.min(settings.get_int('topbar-monitor'), monitorModel.get_n_items() - 1),
        });
        monitorRow.connect('notify::selected', () => {
            settings.set_int('topbar-monitor', monitorRow.selected);
        });
        monitorGroup.add(monitorRow);

        const langClockGroup = new Adw.PreferencesGroup({
            title: _('Языковой индикатор и часы'),
        });
        pageTopbar.add(langClockGroup);

        addSwitch(langClockGroup, 'Заглавные буквы раскладки (RU)', 'Писать код языка заглавными (никогда не сбрасывается)', 'keyboard-uppercase');
        addSwitch(langClockGroup, 'Отображать день недели', 'Добавить короткий день недели к часам', 'clock-show-weekday');
        addSwitch(langClockGroup, 'Отображать секунды', 'Показывать секунды в часах верхней панели', 'clock-show-seconds');

        const topbarColorGroup = new Adw.PreferencesGroup({
            title: _('Фон и стиль топбара'),
        });
        pageTopbar.add(topbarColorGroup);

        addStyleCombo(topbarColorGroup, 'Стиль фона', 'topbar-style');
        addOpacitySlider(topbarColorGroup, 'Прозрачность топбара', 'topbar-opacity');
        addSwitch(topbarColorGroup, 'Прозрачная подложка в обзоре', 'Плавно скрывать фон панели при переходе в обзор', 'topbar-transparent-in-overview');

        const topbarVisibilityGroup = new Adw.PreferencesGroup({
            title: _('Видимость элементов панели'),
        });
        pageTopbar.add(topbarVisibilityGroup);

        addSwitch(topbarVisibilityGroup, 'Верхняя панель', null, 'panel-visibility');
        addSwitch(topbarVisibilityGroup, 'Не скрывать в полноэкранном режиме', 'Отображать топбар даже когда приложения открыты во весь экран (Force Top Bar)', 'topbar-show-in-fullscreen');
        addSwitch(topbarVisibilityGroup, 'Кнопка «Обзор»', null, 'activities-button');
        addSwitch(topbarVisibilityGroup, 'Часы и дата', null, 'clock-menu');
        addSwitch(topbarVisibilityGroup, 'Меню доступности', null, 'accessibility-menu');
        addSwitch(topbarVisibilityGroup, 'Меню «Быстрые настройки»', null, 'quicksettings-button');


        // ==========================================
        // 2. ВКЛАДКА: ДОК (DASH & DOCK)
        // ==========================================
        const pageDock = new Adw.PreferencesPage({
            title: _('Док-панель'),
            icon_name: 'view-app-grid-symbolic',
        });
        addSection('dock', 'Док-панель', 'view-app-grid-symbolic', pageDock);

        const dockFeaturesGroup = new Adw.PreferencesGroup({
            title: _('Элементы и поведение дока'),
            description: _('Тонкая настройка Dash, закрепление и анимации'),
        });
        pageDock.add(dockFeaturesGroup);

        const rowAlwaysVisible = addSwitch(dockFeaturesGroup, 'Показывать док на рабочем столе', 'Закрепить док на рабочем столе с резервированием пространства', 'dock-always-visible');
        const rowIntellihide = addSwitch(dockFeaturesGroup, 'Интеллектуальное скрытие', 'Прятать док, если его перекрывает окно приложения', 'dock-intellihide');
        rowIntellihide.sensitive = rowAlwaysVisible.active;
        rowAlwaysVisible.connect('notify::active', () => {
            rowIntellihide.sensitive = rowAlwaysVisible.active;
        });

        addSwitch(dockFeaturesGroup, 'Анимация увеличения иконок (macOS Magnification)', 'Иконки эффектно увеличиваются и приподнимаются при наведении', 'dock-magnification');
        addSwitch(dockFeaturesGroup, 'Цвет счетчика в цвет акцента', 'Окрашивать бейдж уведомлений в акцентный цвет вместо красного', 'dock-notification-badge-accent');
        const rowBar = addSwitch(dockFeaturesGroup, 'Одиночная полоска активности', 'Отображать одну полоску под активными приложениями вместо точек', 'dock-running-indicator-bar');
        addSwitch(dockFeaturesGroup, 'Отображать съемные носители и диски', 'Показывать подключенные USB-флешки и смонтированные накопители', 'dock-show-mounts');
        addSwitch(dockFeaturesGroup, 'Отображать корзину', 'Показывать иконку корзины в доке', 'dock-show-trash');
        addSwitch(dockFeaturesGroup, 'Скрыть счетчик уведомлений', 'Не отображать бейдж с количеством уведомлений на иконках', 'dock-notification-badge-hide');
        addSwitch(dockFeaturesGroup, 'Скрыть всплывающие подсказки', 'Отключить всплывающие подписи при наведении мыши', 'dock-tooltips-hide');
        addSwitch(dockFeaturesGroup, 'Скрыть разделитель', 'Скрыть полосу между избранными и запущенными', 'dock-separator-hide');
        addSwitch(dockFeaturesGroup, 'Скрыть кнопку приложений', 'Скрыть иконку сетки (девять точек)', 'dock-show-apps-hide');
        const rowHideDots = addSwitch(dockFeaturesGroup, 'Скрыть индикаторы активности', 'Полностью скрыть любые метки активности под программами', 'dock-running-dots-hide');

        rowBar.sensitive = !rowHideDots.active;
        rowHideDots.connect('notify::active', () => {
            rowBar.sensitive = !rowHideDots.active;
        });

        const dockSizeGroup = new Adw.PreferencesGroup({
            title: _('Размер иконок дока'),
        });
        pageDock.add(dockSizeGroup);

        const iconSizeRow = new Adw.SpinRow({
            title: _('Размер иконок (px)'),
            adjustment: new Gtk.Adjustment({ lower: 24, upper: 96, step_increment: 4, page_increment: 8, value: settings.get_int('dock-icon-size') }),
        });
        iconSizeRow.connect('notify::value', () => {
            settings.set_int('dock-icon-size', iconSizeRow.value);
        });
        dockSizeGroup.add(iconSizeRow);

        const dockStyleGroup = new Adw.PreferencesGroup({
            title: _('Стиль подложки дока'),
        });
        pageDock.add(dockStyleGroup);

        addStyleCombo(dockStyleGroup, 'Стиль фона дока', 'dock-style');
        addOpacitySlider(dockStyleGroup, 'Прозрачность дока', 'dock-opacity');

        const dockMonitorGroup = new Adw.PreferencesGroup({
            title: _('Дисплей для док-панели'),
            description: _('Выбор экрана, на котором располагается док'),
        });
        pageDock.add(dockMonitorGroup);

        const dockMonitorModel = new Gtk.StringList();
        dockMonitorModel.append(_('Как у верхней панели'));
        detectedMons.forEach(m => dockMonitorModel.append(m));
        dockMonitorModel.append(_('На всех экранах'));

        const dockMonitorRow = new Adw.ComboRow({
            title: _('Расположение дока'),
            model: dockMonitorModel,
            selected: Math.min(settings.get_int('dock-monitor'), dockMonitorModel.get_n_items() - 1),
        });
        dockMonitorRow.connect('notify::selected', () => {
            settings.set_int('dock-monitor', dockMonitorRow.selected);
        });
        dockMonitorGroup.add(dockMonitorRow);


        // ==========================================
        // 3. ВКЛАДКА: ОБЗОР (OVERVIEW)
        // ==========================================
        const pageOverview = new Adw.PreferencesPage({
            title: _('Овервью и окна'),
            icon_name: 'view-grid-symbolic',
        });
        addSection('overview', 'Овервью и окна', 'view-grid-symbolic', pageOverview);

        const overviewStyleGroup = new Adw.PreferencesGroup({
            title: _('Фон режима обзора (Overview)'),
            description: _('Настройка фона режима обзора'),
        });
        pageOverview.add(overviewStyleGroup);

        addStyleCombo(overviewStyleGroup, 'Стиль фона обзора', 'overview-style');
        addOpacitySlider(overviewStyleGroup, 'Прозрачность фона обзора', 'overview-opacity');

        const overviewElementsGroup = new Adw.PreferencesGroup({
            title: _('Элементы режима обзора и окон'),
        });
        pageOverview.add(overviewElementsGroup);

        addSwitch(overviewElementsGroup, 'Скрыть кнопку закрытия окон (крестик)', null, 'overview-window-close-button-hide');
        addSwitch(overviewElementsGroup, 'Скрыть иконку приложения на окне', null, 'overview-window-icon-hide');
        addSwitch(overviewElementsGroup, 'Скрыть заголовок окна', 'Полное скрытие заголовка без пустых черных рамок', 'overview-window-title-hide');
        addSwitch(overviewElementsGroup, 'Скрыть строку поиска', null, 'overview-search-hide');
        addSwitch(overviewElementsGroup, 'Скрыть миниатюры рабочих столов', null, 'overview-workspace-switcher-hide');


        // ==========================================
        // 4. ВКЛАДКА: УВЕДОМЛЕНИЯ (NOTIFICATIONS)
        // ==========================================
        const pageNotifications = new Adw.PreferencesPage({
            title: _('Уведомления и OSD'),
            icon_name: 'preferences-system-notifications-symbolic',
        });
        addSection('notifications', 'Уведомления и OSD', 'preferences-system-notifications-symbolic', pageNotifications);

        const notifPositionGroup = new Adw.PreferencesGroup({
            title: _('Расположение всплывающих уведомлений'),
            description: _('Выбор монитора и горизонтального положения баннера'),
        });
        pageNotifications.add(notifPositionGroup);

        const notifMonitorModel = new Gtk.StringList();
        notifMonitorModel.append(_('Основной экран'));
        detectedMons.forEach(m => notifMonitorModel.append(m));

        const notifMonitorRow = new Adw.ComboRow({
            title: _('Монитор для баннеров'),
            model: notifMonitorModel,
            selected: Math.min(settings.get_int('notification-monitor'), notifMonitorModel.get_n_items() - 1),
        });
        notifMonitorRow.connect('notify::selected', () => {
            settings.set_int('notification-monitor', notifMonitorRow.selected);
        });
        notifPositionGroup.add(notifMonitorRow);

        const hAlignModel = new Gtk.StringList();
        hAlignModel.append(_('По центру'));
        hAlignModel.append(_('Слева'));
        hAlignModel.append(_('Справа'));
        const hAlignValues = ['center', 'left', 'right'];

        const hAlignRow = new Adw.ComboRow({
            title: _('Положение по горизонтали'),
            model: hAlignModel,
            selected: Math.max(0, hAlignValues.indexOf(settings.get_string('notification-horizontal-alignment'))),
        });
        hAlignRow.connect('notify::selected', () => {
            settings.set_string('notification-horizontal-alignment', hAlignValues[hAlignRow.selected]);
        });
        notifPositionGroup.add(hAlignRow);

        const notifStyleGroup = new Adw.PreferencesGroup({
            title: _('Стиль баннера уведомлений'),
        });
        pageNotifications.add(notifStyleGroup);

        addStyleCombo(notifStyleGroup, 'Стиль фона плашки', 'notification-style');
        addOpacitySlider(notifStyleGroup, 'Прозрачность плашки', 'notification-opacity');

        const notifOptionsGroup = new Adw.PreferencesGroup({
            title: _('Дополнительные параметры'),
        });
        pageNotifications.add(notifOptionsGroup);

        addSwitch(notifOptionsGroup, 'Скрыть кнопку закрытия (крестик) на баннере', null, 'notification-close-button-hide');
        addSwitch(notifOptionsGroup, 'Скрыть иконку уведомлений в верхней панели', null, 'panel-notification-icon-hide');

        const timeoutRow = new Adw.SpinRow({
            title: _('Время показа баннера (секунды)'),
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 20, step_increment: 1, page_increment: 2, value: settings.get_int('notification-timeout') }),
        });
        timeoutRow.connect('notify::value', () => {
            settings.set_int('notification-timeout', timeoutRow.value);
        });
        notifOptionsGroup.add(timeoutRow);

        const osdGroup = new Adw.PreferencesGroup({
            title: _('Индикаторы громкости и яркости (OSD)'),
            description: _('Всплывающие плашки при регулировке звука энкодером, клавишами или яркости'),
        });
        pageNotifications.add(osdGroup);

        const osdMonitorModel = new Gtk.StringList();
        osdMonitorModel.append(_('Основной экран'));
        osdMonitorModel.append(_('На всех экранах'));
        const osdMonitorValues = [0, -1];

        detectedMons.forEach((m, idx) => {
            osdMonitorModel.append(m);
            osdMonitorValues.push(idx + 1);
        });

        const currentOsdVal = settings.get_int('osd-monitor');
        const osdSelectedIdx = osdMonitorValues.indexOf(currentOsdVal);

        const osdMonitorRow = new Adw.ComboRow({
            title: _('Монитор для индикатора громкости и яркости'),
            model: osdMonitorModel,
            selected: osdSelectedIdx >= 0 ? osdSelectedIdx : 0,
        });
        osdMonitorRow.connect('notify::selected', () => {
            const val = osdMonitorValues[osdMonitorRow.selected] ?? 0;
            settings.set_int('osd-monitor', val);
        });
        osdGroup.add(osdMonitorRow);


        // ==========================================
        // 5. ШТОРКА (DATEMENU)
        // ==========================================
        const pageDateMenu = new Adw.PreferencesPage({
            title: _('Календарь и часы'),
            icon_name: 'x-office-calendar-symbolic',
        });
        addSection('datemenu', 'Календарь и часы', 'x-office-calendar-symbolic', pageDateMenu);

        const calendarGroup = new Adw.PreferencesGroup({
            title: _('Календарь и секции шторки'),
            description: _('Настройка элементов выпадающего меню часов'),
        });
        pageDateMenu.add(calendarGroup);

        const rowHideRight = addSwitch(calendarGroup, 'Скрыть правую часть (Календарь и события)', 'Полностью скрыть правую колонку со всеми виджетами', 'datemenu-calendar-hide');
        addSwitch(calendarGroup, 'Компактный режим при отсутствии уведомлений', 'Скрыть текст «Нет уведомлений» и центрировать иконку', 'datemenu-compact-empty');
        const rowWeather = addSwitch(calendarGroup, 'Скрыть секцию погоды', null, 'datemenu-weather-hide');
        const rowClocks = addSwitch(calendarGroup, 'Скрыть мировые часы', null, 'datemenu-world-clocks-hide');
        const rowEvents = addSwitch(calendarGroup, 'Скрыть события', null, 'datemenu-events-hide');

        const updateRightSubRows = () => {
            const isRightHidden = rowHideRight.active;
            rowWeather.sensitive = !isRightHidden;
            rowClocks.sensitive = !isRightHidden;
            rowEvents.sensitive = !isRightHidden;
        };
        updateRightSubRows();
        rowHideRight.connect('notify::active', updateRightSubRows);

        const dateMenuStyleGroup = new Adw.PreferencesGroup({
            title: _('Стиль и фон шторки уведомлений'),
        });
        pageDateMenu.add(dateMenuStyleGroup);

        addStyleCombo(dateMenuStyleGroup, 'Стиль фона шторки', 'datemenu-style');
        addOpacitySlider(dateMenuStyleGroup, 'Прозрачность фона шторки', 'datemenu-opacity');


        // ==========================================
        // 6. ВКЛАДКА: БЫСТРЫЕ НАСТРОЙКИ (QUICK SETTINGS)
        // ==========================================
        const pageQuickSettings = new Adw.PreferencesPage({
            title: _('Быстрые настройки'),
            icon_name: 'emblem-system-symbolic',
        });
        addSection('quicksettings', 'Быстрые настройки', 'emblem-system-symbolic', pageQuickSettings);

        const qsLayoutGroup = new Adw.PreferencesGroup({
            title: _('Компоновка плиток'),
        });
        pageQuickSettings.add(qsLayoutGroup);

        addSwitch(qsLayoutGroup, 'Вытягивать нечетную карточку', 'Растягивать последнюю одиночную плитку на 2 колонки', 'quicksettings-full-width-toggle');
        addSwitch(qsLayoutGroup, 'Фоновые приложения на всю ширину', 'Отображать блок фоновых приложений отдельной широкой строкой снизу вместо плитки в сетке', 'quicksettings-background-apps-full-width');

        const qsButtonsGroup = new Adw.PreferencesGroup({
            title: _('Круглые системные кнопки'),
            description: _('Прямое скрытие системных кнопок действий внизу шторки быстрых настроек'),
        });
        pageQuickSettings.add(qsButtonsGroup);

        addSwitch(qsButtonsGroup, 'Скрыть кнопку выключения', null, 'qs-power-hide');
        addSwitch(qsButtonsGroup, 'Скрыть кнопку скриншота', null, 'qs-screenshot-hide');
        addSwitch(qsButtonsGroup, 'Скрыть кнопку параметров (шестеренку)', null, 'qs-settings-hide');
        addSwitch(qsButtonsGroup, 'Скрыть кнопку блокировки экрана', null, 'qs-lock-hide');

        const qsStyleGroup = new Adw.PreferencesGroup({
            title: _('Стиль меню Quick Settings'),
        });
        pageQuickSettings.add(qsStyleGroup);

        addStyleCombo(qsStyleGroup, 'Стиль подложки', 'quicksettings-style');
        addOpacitySlider(qsStyleGroup, 'Прозрачность Quick Settings', 'quicksettings-opacity');


        // ==========================================
        // 7. ВКЛАДКА: СКРИНШОТЫ (SCREENSHOTS)
        // ==========================================
        const pageScreenshots = new Adw.PreferencesPage({
            title: _('Скриншоты'),
            icon_name: 'applets-screenshooter-symbolic',
        });
        addSection('screenshots', 'Скриншоты', 'applets-screenshooter-symbolic', pageScreenshots);

        const screenshotNamingGroup = new Adw.PreferencesGroup({
            title: _('Имя и сохранение файлов'),
            description: _('Настройка шаблона названия файлов и режима сохранения снимков'),
        });
        pageScreenshots.add(screenshotNamingGroup);

        const namingModel = new Gtk.StringList();
        namingModel.append(_('Дата и время'));
        namingModel.append(_('Случайное число'));
        namingModel.append(_('По умолчанию'));
        const namingValues = ['date', 'random', 'default'];

        const namingRow = new Adw.ComboRow({
            title: _('Формат названия файла'),
            model: namingModel,
            selected: Math.max(0, namingValues.indexOf(settings.get_string('screenshot-filename-format'))),
        });
        namingRow.connect('notify::selected', () => {
            settings.set_string('screenshot-filename-format', namingValues[namingRow.selected]);
        });
        screenshotNamingGroup.add(namingRow);

        addSwitch(screenshotNamingGroup, 'Только буфер обмена', 'Копировать скриншот в буфер обмена без сохранения файла на диск', 'screenshot-clipboard-only');

        const saveLocModel = new Gtk.StringList();
        saveLocModel.append(_('Подпапка «Снимки экрана»'));
        saveLocModel.append(_('Папка «Изображения»'));
        const saveLocValues = ['subfolder', 'pictures'];

        const saveLocRow = new Adw.ComboRow({
            title: _('Папка для сохранения файлов'),
            model: saveLocModel,
            selected: Math.max(0, saveLocValues.indexOf(settings.get_string('screenshot-save-location'))),
        });
        saveLocRow.connect('notify::selected', () => {
            settings.set_string('screenshot-save-location', saveLocValues[saveLocRow.selected]);
        });
        screenshotNamingGroup.add(saveLocRow);

        const screenshotSoundGroup = new Adw.PreferencesGroup({
            title: _('Звук создания снимка'),
            description: _('Выбор звукового эффекта при захвате экрана'),
        });
        pageScreenshots.add(screenshotSoundGroup);

        const soundModel = new Gtk.StringList();
        soundModel.append(_('Щелчок камеры'));
        soundModel.append(_('Мягкий клик'));
        soundModel.append(_('Без звука'));
        const soundValues = ['default', 'bubble', 'disabled'];

        const soundRow = new Adw.ComboRow({
            title: _('Звук затвора'),
            model: soundModel,
            selected: Math.max(0, soundValues.indexOf(settings.get_string('screenshot-sound'))),
        });
        soundRow.connect('notify::selected', () => {
            settings.set_string('screenshot-sound', soundValues[soundRow.selected]);
        });
        screenshotSoundGroup.add(soundRow);

        const screenshotUiGroup = new Adw.PreferencesGroup({
            title: _('Интерфейс и скорость съемки'),
            description: _('Поведение оверлея скриншотов при нажатии PrintScreen'),
        });
        pageScreenshots.add(screenshotUiGroup);

        addSwitch(screenshotUiGroup, 'Показывать указатель мыши', 'Отображать курсор мыши на создаваемых скриншотах по умолчанию', 'screenshot-show-pointer');
        addSwitch(screenshotUiGroup, 'Быстрый скриншот', 'Мгновенный снимок сразу после выделения области мышью (без нажатия Enter)', 'screenshot-quick-capture');
        addSwitch(screenshotUiGroup, 'Сбросить область выделения', 'Не оставлять рамку выделения по умолчанию при открытии меню скриншота', 'screenshot-clear-selection');
        addSwitch(screenshotUiGroup, 'Скрыть нижнее меню инструментов', 'Скрыть панель с кнопками «Область / Экран / Окно / Видео» для чистого экрана', 'screenshot-hide-panel');


        // ==========================================
        // 8. ВКЛАДКА: БУФЕР ОБМЕНА И ЭМОДЗИ (CLIPBOARD & EMOJI)
        // ==========================================
        const pageClipboard = new Adw.PreferencesPage({
            title: _('Буфер и Эмодзи'),
            icon_name: 'edit-paste-symbolic',
        });
        addSection('clipboard', 'Буфер и эмодзи', 'edit-paste-symbolic', pageClipboard);

        const clipboardGroup = new Adw.PreferencesGroup({
            title: _('Буфер обмена и Эмодзи'),
            description: _('Встроенный менеджер истории буфера обмена и панель выбора эмодзи'),
        });
        pageClipboard.add(clipboardGroup);

        addSwitch(clipboardGroup, 'Включить буфер обмена и эмодзи', 'Сохраняет историю буфера обмена и предоставляет всплывающее окно выбора', 'clipboard-enable');
        addSwitch(clipboardGroup, 'Иконка в топбаре', 'Отображать значок буфера на верхней панели рядом со шторкой', 'clipboard-topbar-icon');
        addSwitch(clipboardGroup, 'Автоматическая вставка при выборе', 'Автоматически вставляет скопированную запись или эмодзи сразу в активное окно', 'clipboard-auto-paste');
        addSwitch(clipboardGroup, 'Очищать историю при перезагрузке', 'Очищает обычную историю при старте системы, сохраняя избранные (закреплённые) записи', 'clipboard-clear-on-reboot');

        const limitRow = new Adw.SpinRow({
            title: _('Лимит истории буфера'),
            subtitle: _('Количество сохраняемых записей в истории (от 10 до 500)'),
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
            title: _('Горячие клавиши и внешний вызов'),
            description: _('Глобальные сочетания клавиш и консольные команды для биндов'),
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
                        label: _('Не назначено'),
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
                tooltip_text: _('Сбросить на значение по умолчанию'),
            });
            resetBtn.connect('clicked', () => {
                settings.set_strv(schemaKey, defaultKeys);
            });
            box.append(resetBtn);

            row.add_suffix(box);
            return row;
        }

        clipboardShortcutsGroup.add(createShortcutRow(
            _('Сочетание для истории буфера'),
            _('Глобальный перехват GNOME Shell (активен во всех приложениях)'),
            'clipboard-shortcut',
            ['<Super>v']
        ));

        clipboardShortcutsGroup.add(createShortcutRow(
            _('Сочетание для эмодзи'),
            _('Глобальный перехват GNOME Shell (активен во всех приложениях)'),
            'emoji-shortcut',
            ['<Super>period']
        ));

        // Команда для скриптов / ручного бинда в GNOME Control Center
        function createCommandRow(title, subtitle, cmdText) {
            const row = new Adw.ActionRow({
                title: title,
                subtitle: subtitle,
            });
            const btn = new Gtk.Button({
                label: _('Скопировать'),
                valign: Gtk.Align.CENTER,
                css_classes: ['suggested-action'],
            });
            btn.connect('clicked', () => {
                const clipboard = Gdk.Display.get_default()?.get_clipboard();
                clipboard?.set(cmdText);
                btn.label = _('Скопировано!');
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                    btn.label = _('Скопировать');
                    return GLib.SOURCE_REMOVE;
                });
            });
            row.add_suffix(btn);
            return row;
        }

        clipboardShortcutsGroup.add(createCommandRow(
            _('Команда вызова буфера обмена'),
            'qpatcher-clipboard',
            'qpatcher-clipboard'
        ));

        clipboardShortcutsGroup.add(createCommandRow(
            _('Команда вызова эмодзи'),
            'qpatcher-emoji',
            'qpatcher-emoji'
        ));

        clipboardShortcutsGroup.add(createCommandRow(
            _('Прямой D-Bus вызов (без PATH)'),
            _('gdbus call --session --dest org.gnome.Shell ...'),
            `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/QPatcher --method org.gnome.Shell.Extensions.QPatcher.OpenClipboard 'clipboard'`
        ));


        // ==========================================
        // 9. ВКЛАДКА: ПРОЧЕЕ (SYSTEM & THEME)
        // ==========================================
        const pageOther = new Adw.PreferencesPage({
            title: _('Внешний вид и система'),
            icon_name: 'preferences-other-symbolic',
        });
        addSection('other', 'Внешний вид и система', 'preferences-other-symbolic', pageOther);

        const themeColorGroup = new Adw.PreferencesGroup({
            title: _('Единый цвет темы (Theme Color)'),
            description: _('Базовый оттенок для всех панелей, меню и подложек'),
        });
        pageOther.add(themeColorGroup);

        addSwitch(themeColorGroup, 'Перекрашивать все меню и диалоги', 'Применять единый цвет темы к контекстным меню, языку и системным окнам', 'recolor-all-menus-and-dialogs');
        addStyleCombo(themeColorGroup, 'Стиль меню и диалогов', 'menus-dialogs-style');

        const curColor = settings.get_string('theme-color') || '#1e1e2e';
        const paletteActionRow = new Adw.ActionRow({
            title: _('Готовая палитра темных и нейтральных оттенков'),
            subtitle: _(`Текущий цвет: ${curColor}`),
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
                paletteActionRow.subtitle = _(`Текущий цвет: ${p.name} (${p.hex})`);
            });
            paletteGrid.append(btn);
        });

        const accentGroup = new Adw.PreferencesGroup({
            title: _('Системный акцентный цвет (GNOME Native)'),
            description: _('Официальная палитра акцентных цветов системы'),
        });
        pageOther.add(accentGroup);

        const accentNames = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];
        const accentLabels = [
            _('Синий'),
            _('Бирюзовый'),
            _('Зелёный'),
            _('Жёлтый'),
            _('Оранжевый'),
            _('Красный'),
            _('Розовый'),
            _('Фиолетовый'),
            _('Серый'),
        ];

        const accentModel = new Gtk.StringList();
        accentLabels.forEach(l => accentModel.append(l));

        const currentAccent = interfaceSettings.get_string('accent-color') || 'blue';
        const accentRow = new Adw.ComboRow({
            title: _('Акцентный цвет оформления'),
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
            title: _('Глобальные темы оформления'),
            description: _('Быстрое переключение системных режимов'),
        });
        pageOther.add(systemThemeGroup);

        addSwitch(systemThemeGroup, 'Тёмный стиль (Dark Style)', 'Использовать системную тёмную тему', 'dark-mode');

        const lockGroup = new Adw.PreferencesGroup({
            title: _('Экран блокировки и входа (Lock Screen / Login)'),
            description: _('Поведение экрана блокировки и экрана авторизации'),
        });
        pageOther.add(lockGroup);

        addSwitch(lockGroup, 'Патчить топбар и стиль на экране блокировки', 'Переносит топбар на выбранный монитор и сохраняет заглавный язык и стили', 'lockscreen-topbar-enable');
        addSwitch(lockGroup, 'Сразу открывать ввод пароля (без шторы часов)', 'Автоматически пропускает экран с часами на локскрине и сразу активирует поле ввода', 'lockscreen-auto-focus-password');
        addSwitch(lockGroup, 'Не тушить экран при блокировке (Win+L)', 'Оставляет экран блокировки с часами и обоями включенным, не выключая мониторы', 'lockscreen-prevent-blank');
        addSwitch(lockGroup, 'Блокировать экран при автологине (Boot Lock)', 'Если в GDM включен автоматический вход, система при загрузке сразу покажет кастомный экран блокировки', 'autologin-lock-on-boot');

        // Обработка переключения разделов сайдбара
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
    
    window.present();
});

app.run([]);
