import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class QPatcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
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

        const addStyleCombo = (group, title, schemaKey, allowBlur = false) => {
            const model = new Gtk.StringList();
            model.append(_('По умолчанию (GNOME Default)'));
            model.append(_('В цвет темы / Прозрачность'));
            if (allowBlur) {
                model.append(_('Размытие (Blur)'));
            }

            const styles = allowBlur ? ['default', 'theme-grey', 'blur'] : ['default', 'theme-grey'];
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


        // ==========================================
        // 1. ВКЛАДКА: ТОПБАР
        // ==========================================
        const pageTopbar = new Adw.PreferencesPage({
            title: _('Топбар'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(pageTopbar);

        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Монитор топбара'),
            description: _('Выбор физического дисплея для верхней панели'),
        });
        pageTopbar.add(monitorGroup);

        const monitorModel = new Gtk.StringList();
        monitorModel.append(_('Основной монитор (Primary)'));
        try {
            const display = Gdk.Display.get_default();
            if (display) {
                const monitors = display.get_monitors();
                for (let i = 0; i < monitors.get_n_items(); i++) {
                    const mon = monitors.get_item(i);
                    const desc = mon.get_description() || mon.get_connector() || `Монитор ${i + 1}`;
                    const connector = mon.get_connector() ? ` (${mon.get_connector()})` : '';
                    monitorModel.append(`${desc}${connector}`);
                }
            }
        } catch (e) {}

        const monitorRow = new Adw.ComboRow({
            title: _('Дисплей для панели'),
            model: monitorModel,
            selected: settings.get_int('topbar-monitor'),
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
        addSwitch(topbarVisibilityGroup, 'Кнопка «Обзор»', null, 'activities-button');
        addSwitch(topbarVisibilityGroup, 'Часы и дата', null, 'clock-menu');
        addSwitch(topbarVisibilityGroup, 'Меню доступности', null, 'accessibility-menu');
        addSwitch(topbarVisibilityGroup, 'Меню «Быстрые настройки»', null, 'quicksettings-button');


        // ==========================================
        // 2. ВКЛАДКА: ДОК (DASH & DOCK)
        // ==========================================
        const pageDock = new Adw.PreferencesPage({
            title: _('Док'),
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(pageDock);

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
        addSwitch(dockFeaturesGroup, 'Одиночная полоска активности', 'Отображать одну полоску под активными приложениями вместо точек', 'dock-running-indicator-bar');
        addSwitch(dockFeaturesGroup, 'Отображать съемные носители и диски', 'Показывать подключенные USB-флешки и смонтированные накопители', 'dock-show-mounts');
        addSwitch(dockFeaturesGroup, 'Скрыть счетчик уведомлений', 'Не отображать бейдж с количеством уведомлений на иконках', 'dock-notification-badge-hide');
        addSwitch(dockFeaturesGroup, 'Скрыть всплывающие подсказки', 'Отключить всплывающие подписи при наведении мыши', 'dock-tooltips-hide');
        addSwitch(dockFeaturesGroup, 'Скрыть разделитель', 'Скрыть полосу между избранными и запущенными', 'dock-separator-hide');
        addSwitch(dockFeaturesGroup, 'Скрыть кнопку приложений', 'Скрыть иконку сетки (девять точек)', 'dock-show-apps-hide');
        addSwitch(dockFeaturesGroup, 'Скрыть точки активности', 'Не показывать точки под запущенными программами', 'dock-running-dots-hide');

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


        // ==========================================
        // 3. ВКЛАДКА: ОБЗОР (OVERVIEW)
        // ==========================================
        const pageOverview = new Adw.PreferencesPage({
            title: _('Обзор'),
            icon_name: 'view-grid-symbolic',
        });
        window.add(pageOverview);

        const overviewStyleGroup = new Adw.PreferencesGroup({
            title: _('Фон режима обзора (Overview)'),
            description: _('Настоящее размытие обоев рабочего стола без серой подложки'),
        });
        pageOverview.add(overviewStyleGroup);

        addStyleCombo(overviewStyleGroup, 'Стиль фона обзора', 'overview-style', true);
        addOpacitySlider(overviewStyleGroup, 'Прозрачность фона обзора', 'overview-opacity');

        const sigmaRow = new Adw.SpinRow({
            title: _('Интенсивность размытия (Sigma)'),
            subtitle: _('Радиус размытия обоев в режиме обзора (от 0 до 100)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 5, page_increment: 10, value: settings.get_int('blur-sigma') }),
        });
        sigmaRow.connect('notify::value', () => {
            settings.set_int('blur-sigma', sigmaRow.value);
        });
        overviewStyleGroup.add(sigmaRow);

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
            title: _('Уведомления'),
            icon_name: 'preferences-system-notifications-symbolic',
        });
        window.add(pageNotifications);

        const notifPositionGroup = new Adw.PreferencesGroup({
            title: _('Расположение всплывающих уведомлений'),
            description: _('Выбор монитора и горизонтального положения баннера'),
        });
        pageNotifications.add(notifPositionGroup);

        const notifMonitorModel = new Gtk.StringList();
        notifMonitorModel.append(_('Основной монитор (Primary)'));
        try {
            const display = Gdk.Display.get_default();
            if (display) {
                const monitors = display.get_monitors();
                for (let i = 0; i < monitors.get_n_items(); i++) {
                    const mon = monitors.get_item(i);
                    const desc = mon.get_description() || mon.get_connector() || `Монитор ${i + 1}`;
                    notifMonitorModel.append(desc);
                }
            }
        } catch (e) {}

        const notifMonitorRow = new Adw.ComboRow({
            title: _('Монитор для всплывающих баннеров'),
            model: notifMonitorModel,
            selected: settings.get_int('notification-monitor'),
        });
        notifMonitorRow.connect('notify::selected', () => {
            settings.set_int('notification-monitor', notifMonitorRow.selected);
        });
        notifPositionGroup.add(notifMonitorRow);

        const hAlignModel = new Gtk.StringList();
        hAlignModel.append(_('По центру (Center)'));
        hAlignModel.append(_('Слева (Left)'));
        hAlignModel.append(_('Справа (Right)'));
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


        // ==========================================
        // 5. ШТОРКА (DATEMENU)
        // ==========================================
        const pageDateMenu = new Adw.PreferencesPage({
            title: _('Шторка'),
            icon_name: 'x-office-calendar-symbolic',
        });
        window.add(pageDateMenu);

        const calendarGroup = new Adw.PreferencesGroup({
            title: _('Календарь и секции шторки'),
            description: _('Настройка элементов выпадающего меню часов'),
        });
        pageDateMenu.add(calendarGroup);

        addSwitch(calendarGroup, 'Скрыть календарь', 'Скрыть виджет календаря (окно автоматически схлопывается)', 'datemenu-calendar-hide');
        addSwitch(calendarGroup, 'Компактный режим при отсутствии уведомлений', 'Скрыть текст "Нет уведомлений" и центрировать иконку', 'datemenu-compact-empty');
        addSwitch(calendarGroup, 'Скрыть секцию погоды', null, 'datemenu-weather-hide');
        addSwitch(calendarGroup, 'Скрыть мировые часы', null, 'datemenu-world-clocks-hide');
        addSwitch(calendarGroup, 'Скрыть события', null, 'datemenu-events-hide');

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
            icon_name: 'preferences-system-symbolic',
        });
        window.add(pageQuickSettings);

        const qsLayoutGroup = new Adw.PreferencesGroup({
            title: _('Компоновка плиток'),
        });
        pageQuickSettings.add(qsLayoutGroup);

        addSwitch(qsLayoutGroup, 'Вытягивать нечетную карточку', 'Растягивать последнюю одиночную плитку на 2 колонки', 'quicksettings-full-width-toggle');

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
            icon_name: 'camera-photo-symbolic',
        });
        window.add(pageScreenshots);

        const screenshotNamingGroup = new Adw.PreferencesGroup({
            title: _('Имя и сохранение файлов'),
            description: _('Настройка шаблона названия файлов и режима сохранения снимков'),
        });
        pageScreenshots.add(screenshotNamingGroup);

        const namingModel = new Gtk.StringList();
        namingModel.append(_('Дата и время (2026-10-25_16.05.30)'));
        namingModel.append(_('Случайное название (6 цифр, например 482910)'));
        namingModel.append(_('По умолчанию (Системное GNOME)'));
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
        saveLocModel.append(_('В подпапку «Снимки экрана» (~/Изображения/Снимки экрана)'));
        saveLocModel.append(_('Напрямую в «Изображения» (~/Изображения)'));
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
        soundModel.append(_('Нейтральный бульк (Мягкий клик громкости)'));
        soundModel.append(_('Отключить звук'));
        soundModel.append(_('По умолчанию (Щелчок затвора камеры)'));
        const soundValues = ['bubble', 'disabled', 'default'];

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

        addSwitch(screenshotUiGroup, 'Быстрый скриншот', 'Мгновенный снимок сразу после выделения области мышью (без нажатия Enter)', 'screenshot-quick-capture');
        addSwitch(screenshotUiGroup, 'Сбросить область выделения', 'Не оставлять рамку выделения по умолчанию при открытии меню скриншота', 'screenshot-clear-selection');
        addSwitch(screenshotUiGroup, 'Скрыть нижнее меню инструментов', 'Скрыть панель с кнопками «Область / Экран / Окно / Видео» для чистого экрана', 'screenshot-hide-panel');


        // ==========================================
        // 8. ВКЛАДКА: ПРОЧЕЕ (SYSTEM, THEME & BLUR)
        // ==========================================
        const pageOther = new Adw.PreferencesPage({
            title: _('Прочее'),
            icon_name: 'preferences-other-symbolic',
        });
        window.add(pageOther);

        const themeColorGroup = new Adw.PreferencesGroup({
            title: _('Единый цвет темы (Theme Color)'),
            description: _('Базовый фоновый цвет для всех панелей и подложек'),
        });
        pageOther.add(themeColorGroup);

        const themeColorRow = new Adw.EntryRow({
            title: _('Цвет подложки (HEX)'),
            text: settings.get_string('theme-color'),
        });
        themeColorRow.connect('changed', () => {
            settings.set_string('theme-color', themeColorRow.text);
        });
        themeColorGroup.add(themeColorRow);

        addSwitch(themeColorGroup, 'Перекрашивать все меню и диалоги', 'Применять единый цвет темы к контекстным меню, языку и системным окнам', 'recolor-all-menus-and-dialogs');
        addStyleCombo(themeColorGroup, 'Стиль меню и диалогов', 'menus-dialogs-style');

        // Палитра готовых нейтральных и пастельных оттенков в один клик
        const paletteActionRow = new Adw.ActionRow({
            title: _('Готовые нейтральные и пастельные оттенки'),
            subtitle: _('Кликните по плитке для мгновенного выбора цвета'),
        });
        themeColorGroup.add(paletteActionRow);

        const paletteBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });
        paletteActionRow.add_suffix(paletteBox);

        const presets = [
            { name: 'Graphite', hex: '#1e1e2e' },
            { name: 'Charcoal', hex: '#24273a' },
            { name: 'Slate Blue', hex: '#2b2d42' },
            { name: 'Nord Dark', hex: '#3b4252' },
            { name: 'Cool Grey', hex: '#3c3f4a' },
            { name: 'Warm Taupe', hex: '#363238' },
            { name: 'Deep Espresso', hex: '#262427' },
            { name: 'Obsidian', hex: '#18181b' },
        ];

        presets.forEach(p => {
            const btn = new Gtk.Button({
                tooltip_text: `${p.name} (${p.hex})`,
                css_classes: ['palette-chip'],
            });
            const chipProvider = new Gtk.CssProvider();
            chipProvider.load_from_data(`button { background-color: ${p.hex}; }`, -1);
            btn.get_style_context().add_provider(chipProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            btn.connect('clicked', () => {
                themeColorRow.text = p.hex;
                settings.set_string('theme-color', p.hex);
            });
            paletteBox.append(btn);
        });


        const accentGroup = new Adw.PreferencesGroup({
            title: _('Системный акцентный цвет (GNOME Native)'),
            description: _('Официальная палитра акцентных цветов системы'),
        });
        pageOther.add(accentGroup);

        const accentNames = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];
        const accentLabels = [
            _('Синий (Blue)'),
            _('Бирюзовый (Teal)'),
            _('Зелёный (Green)'),
            _('Жёлтый (Yellow)'),
            _('Оранжевый (Orange)'),
            _('Красный (Red)'),
            _('Розовый (Pink)'),
            _('Фиолетовый (Purple)'),
            _('Сланцевый (Slate)')
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
            title: _('Экран блокировки (Lock Screen)'),
            description: _('Поведение системы при блокировке по Win+L'),
        });
        pageOther.add(lockGroup);

        addSwitch(lockGroup, 'Не тушить экран при блокировке (Win+L)', 'Оставляет экран блокировки с часами и обоями включенным, не выключая мониторы', 'lockscreen-prevent-blank');
    }
}
