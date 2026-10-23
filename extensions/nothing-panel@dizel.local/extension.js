import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DIGITS = {
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};
const COLON = ['.', '.', '#', '.', '#', '.', '.'];

const CLOUD = [
    '.........',
    '..##.##..',
    '.#..#..#.',
    '#.......#',
    '#.......#',
    '.#.....#.',
    '..#####..',
    '.........',
    '.........',
];
const WEATHER_ICONS = {
    sun: ['....#....', '.#.....#.', '...#.#...', '..#####..', '#.##.##.#', '..#####..', '...#.#...', '.#.....#.', '....#....'],
    moon: ['...###...', '..##.....', '.##......', '.##......', '.##......', '.###.....', '..######.', '...####..', '.........'],
    partly: ['#..#.....', '.#.#.....', '....##.##', '...#...#.', '..#.....#', '.#.....#.', '..#####..', '.........', '.........'],
    cloud: CLOUD,
    rain: ['..##.##..', '.#..#..#.', '#.......#', '.#.....#.', '..#####..', '.#...#...', '#...#...#', '.........', '.#...#...'],
    snow: ['..##.##..', '.#..#..#.', '#.......#', '.#.....#.', '..#####..', '.#...#...', '...#...#.', '.#...#...', '.........'],
    storm: ['..##.##..', '.#..#..#.', '#.......#', '.#.....#.', '..#####..', '....##...', '...##....', '....##...', '...#.....'],
    fog: ['.........', '#.#.#.#.#', '.........', '.#.#.#.#.', '.........', '#.#.#.#.#', '.........', '.#.#.#.#.', '.........'],
};

const CLOCK_PITCH = 7;
const SECONDS_PITCH = 3.5;
const SECONDS_GAP = 10;
const CLOCK_HEIGHT = 7 * CLOCK_PITCH;
const CLOCK_WIDTH = 24 * CLOCK_PITCH + 2 * CLOCK_PITCH + SECONDS_GAP - CLOCK_PITCH + 11 * SECONDS_PITCH;
const LOCK_PITCH = 18;
const LOCK_HEIGHT = 7 * LOCK_PITCH;
// Four digits and a colon, without the empty column after the last digit.
const LOCK_WIDTH = 25 * LOCK_PITCH;
const WEATHER_REFRESH_US = 10 * 60 * 1e6;
const ZONE_NAMES = {
    'Europe/Moscow': 'Москва',
    'Europe/Kaliningrad': 'Калининград',
    'Europe/Samara': 'Самара',
    'Asia/Yekaterinburg': 'Екатеринбург',
    'Asia/Omsk': 'Омск',
    'Asia/Novosibirsk': 'Новосибирск',
    'Asia/Krasnoyarsk': 'Красноярск',
    'Asia/Irkutsk': 'Иркутск',
    'Asia/Yakutsk': 'Якутск',
    'Asia/Vladivostok': 'Владивосток',
    'Asia/Magadan': 'Магадан',
    'Asia/Kamchatka': 'Камчатка',
};
const CITY_NAMES = {
    moscow: 'Москва',
    saintpetersburg: 'Санкт-Петербург',
    stpetersburg: 'Санкт-Петербург',
    kaliningrad: 'Калининград',
    samara: 'Самара',
    yekaterinburg: 'Екатеринбург',
    ekaterinburg: 'Екатеринбург',
    omsk: 'Омск',
    novosibirsk: 'Новосибирск',
    krasnoyarsk: 'Красноярск',
    irkutsk: 'Иркутск',
    yakutsk: 'Якутск',
    vladivostok: 'Владивосток',
    magadan: 'Магадан',
    petropavlovskkamchatsky: 'Петропавловск-Камчатский',
};

const WAVE_COLUMNS = 24;
const WAVE_ROWS = 5;
const SPARK_COLUMNS = 24;
const SPARK_ROWS = 5;
const BAR_DOTS = 20;
const DISK_EVERY_TICKS = 10;

let mprisSource = null;

function localCity(name, location) {
    let timezone = '';
    try {
        timezone = location?.get_timezone_str?.() ?? '';
    } catch {}
    if (ZONE_NAMES[timezone])
        return ZONE_NAMES[timezone];
    const key = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
    return CITY_NAMES[key] ?? name;
}

function weatherKind(iconName) {
    const name = iconName ?? '';
    if (name.includes('storm'))
        return 'storm';
    if (name.includes('snow'))
        return 'snow';
    if (name.includes('showers') || name.includes('rain'))
        return 'rain';
    if (name.includes('fog') || name.includes('mist'))
        return 'fog';
    if (name.includes('overcast'))
        return 'cloud';
    if (name.includes('few-clouds'))
        return 'partly';
    if (name.includes('clear-night'))
        return 'moon';
    if (name.includes('clear'))
        return 'sun';
    return 'cloud';
}

function zoneText(now) {
    const offsetMinutes = Math.round(now.get_utc_offset() / 6e7);
    const sign = offsetMinutes < 0 ? '−' : '+';
    const hours = Math.floor(Math.abs(offsetMinutes) / 60);
    const minutes = Math.abs(offsetMinutes) % 60;
    const offset = minutes ? `${hours}:${String(minutes).padStart(2, '0')}` : `${hours}`;
    const id = GLib.TimeZone.new_local().get_identifier() ?? '';
    const name = ZONE_NAMES[id] ?? id.split('/').pop().replace(/_/g, ' ');
    return `UTC${sign}${offset}${name ? ` · ${name}` : ''}`.toUpperCase();
}

function drawDots(cr, rows, x0, y0, pitch, radius, lit, color) {
    const [red, green, blue, onAlpha, offAlpha] = color ?? [1, 1, 1, 0.92, 0.07];
    rows.forEach((row, y) => {
        [...row].forEach((cell, x) => {
            const on = lit ? lit(x, y, cell) : cell === '#';
            if (!on && offAlpha <= 0)
                return;
            cr.setSourceRGBA(red, green, blue, on ? onAlpha : offAlpha);
            cr.arc(x0 + x * pitch + pitch / 2, y0 + y * pitch + pitch / 2, radius, 0, 2 * Math.PI);
            cr.fill();
        });
    });
}

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch {
        return '';
    }
}

function formatGb(bytes) {
    const gb = bytes / 1024 ** 3;
    return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1);
}

const DotArea = GObject.registerClass(
class NothingDotArea extends St.DrawingArea {
    constructor(width, height, painter, params = {}) {
        super({width, height, ...params});
        this._painter = painter;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        try {
            this._painter(cr);
        } finally {
            cr.$dispose();
        }
    }
});

class SystemStats {
    constructor() {
        this._cpu = null;
        this._net = null;
        this._netTime = 0;
        this.netHistory = new Array(SPARK_COLUMNS).fill(0);
        this.disk = null;
    }

    cpuPercent() {
        const fields = readText('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number);
        if (fields.length < 8)
            return 0;
        const idle = fields[3] + fields[4];
        const total = fields.reduce((a, b) => a + b, 0);
        const previous = this._cpu;
        this._cpu = {idle, total};
        if (!previous || total === previous.total)
            return 0;
        return Math.round(100 * (1 - (idle - previous.idle) / (total - previous.total)));
    }

    memory() {
        const info = {};
        for (const line of readText('/proc/meminfo').split('\n')) {
            const match = line.match(/^(\w+):\s+(\d+)/);
            if (match)
                info[match[1]] = Number(match[2]) * 1024;
        }
        const total = info.MemTotal ?? 0;
        const used = total - (info.MemAvailable ?? 0);
        return {used, total};
    }

    netSpeed() {
        let bytes = 0;
        for (const line of readText('/proc/net/dev').split('\n').slice(2)) {
            const [name, rest] = line.split(':');
            if (!rest || name.trim() === 'lo')
                continue;
            const values = rest.trim().split(/\s+/).map(Number);
            bytes += values[0] + values[8];
        }
        const now = GLib.get_monotonic_time();
        let speed = 0;
        if (this._net !== null && now > this._netTime)
            speed = Math.max(0, bytes - this._net) / ((now - this._netTime) / 1e6);
        this._net = bytes;
        this._netTime = now;
        this.netHistory.push(speed);
        this.netHistory.shift();
        return speed;
    }

    refreshDisk() {
        try {
            const info = Gio.File.new_for_path(GLib.get_home_dir())
                .query_filesystem_info('filesystem::size,filesystem::free', null);
            this.disk = {
                free: info.get_attribute_uint64('filesystem::free'),
                size: info.get_attribute_uint64('filesystem::size'),
            };
        } catch {
            this.disk = null;
        }
    }
}

const PlayerCard = GObject.registerClass(
class NothingPlayerCard extends St.BoxLayout {
    constructor(player) {
        super({
            style_class: 'np-card np-player',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._player = player;
        this._wave = new Array(WAVE_COLUMNS).fill(1);
        this._waveSource = 0;
        this._active = false;

        const row = new St.BoxLayout({style_class: 'np-player-row', x_expand: true});
        this.add_child(row);

        const info = new St.Button({style_class: 'np-player-info', x_expand: true, can_focus: true});
        const infoBox = new St.BoxLayout({style_class: 'np-player-info-box', x_expand: true});
        info.set_child(infoBox);
        info.connect('clicked', () => {
            this._player.raise();
            Main.panel.closeCalendar();
        });
        row.add_child(info);

        this._cover = new St.Icon({style_class: 'np-cover', icon_size: 44, y_align: Clutter.ActorAlign.CENTER});
        infoBox.add_child(this._cover);

        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._app = new St.Label({style_class: 'np-player-app'});
        this._title = new St.Label({style_class: 'np-player-title'});
        this._artist = new St.Label({style_class: 'np-player-artist'});
        for (const label of [this._app, this._title, this._artist]) {
            label.clutter_text.ellipsize = 3;
            text.add_child(label);
        }
        infoBox.add_child(text);

        const controls = new St.BoxLayout({style_class: 'np-player-controls', y_align: Clutter.ActorAlign.CENTER});
        this._prev = this._control('media-skip-backward-symbolic', () => this._player.previous());
        this._play = this._control('media-playback-start-symbolic', () => this._player.playPause());
        this._next = this._control('media-skip-forward-symbolic', () => this._player.next());
        controls.add_child(this._prev);
        controls.add_child(this._play);
        controls.add_child(this._next);
        row.add_child(controls);

        this._waveArea = new DotArea(WAVE_COLUMNS * 6, WAVE_ROWS * 6, cr => {
            const rows = [];
            for (let y = 0; y < WAVE_ROWS; y++)
                rows.push('.'.repeat(WAVE_COLUMNS));
            drawDots(cr, rows, 0, 0, 6, 1.6, (x, y) => WAVE_ROWS - y <= this._wave[x]);
        }, {style_class: 'np-wave'});
        this.add_child(this._waveArea);

        player.connectObject('changed', () => this._sync(), this);
        this._sync();
        this.connect('destroy', () => this._stopWave());
    }

    _control(iconName, callback) {
        const button = new St.Button({
            style_class: 'np-control',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
        });
        button.connect('clicked', callback);
        return button;
    }

    get playing() {
        return this._player.status === 'Playing';
    }

    setActive(active) {
        this._active = active;
        this._updateWave();
    }

    _sync() {
        const player = this._player;
        this._cover.gicon = player.trackCoverUrl
            ? new Gio.FileIcon({file: Gio.File.new_for_uri(player.trackCoverUrl)})
            : new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
        this._app.text = (player.source?.title ?? player.app?.get_name() ?? '').toUpperCase();
        this._title.text = player.trackTitle ?? '';
        this._artist.text = (player.trackArtists ?? []).join(', ');
        this._play.child.icon_name = this.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        if (this.playing)
            this.add_style_pseudo_class('playing');
        else
            this.remove_style_pseudo_class('playing');
        this._prev.reactive = player.canGoPrevious;
        this._next.reactive = player.canGoNext;
        this._updateWave();
    }

    _updateWave() {
        if (this._active && this.playing) {
            if (!this._waveSource)
                this._waveSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 140, () => this._stepWave());
        } else {
            this._stopWave();
            this._wave.fill(1);
            this._waveArea.queue_repaint();
        }
    }

    _stopWave() {
        if (this._waveSource) {
            GLib.source_remove(this._waveSource);
            this._waveSource = 0;
        }
    }

    _stepWave() {
        for (let i = 0; i < WAVE_COLUMNS; i++) {
            const target = 1 + Math.round(Math.random() * (WAVE_ROWS - 1) * (0.45 + 0.55 * Math.sin((i / WAVE_COLUMNS) * Math.PI)));
            this._wave[i] = Math.round((this._wave[i] + target) / 2);
        }
        this._waveArea.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    }
});

const NothingPanel = GObject.registerClass(
class NothingPanel extends St.BoxLayout {
    constructor(dateMenu) {
        super({
            style_class: 'np-panel',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._dateMenu = dateMenu;
        this._weatherItem = dateMenu._weatherItem;
        this._weatherClient = this._weatherItem?._weatherClient ?? null;
        this._stats = new SystemStats();
        this._cards = new Map();
        this._tick = 0;
        this._timer = 0;
        this._weatherKind = 'cloud';
        this._lastWeather = null;
        this._lastWeatherUpdate = 0;
        this._values = {cpu: 0, ram: 0, disk: 0};

        this._buildHeader();
        this._players = new St.BoxLayout({style_class: 'np-players', orientation: Clutter.Orientation.VERTICAL});
        this.add_child(this._players);
        this._buildStats();

        mprisSource ??= new Mpris.MprisSource();
        mprisSource.connectObject(
            'player-added', (_, player) => this._addPlayer(player),
            'player-removed', (_, player) => this._removePlayer(player),
            this);
        mprisSource.players.forEach(player => this._addPlayer(player));

        if (this._weatherClient) {
            this._weatherClient.connectObject('changed', () => this._syncWeather(), this);
            this._syncWeather();
        }

        this.connect('destroy', () => {
            this.setOpen(false);
            mprisSource?.disconnectObject(this);
            this._weatherClient?.disconnectObject(this);
        });
        this._refreshClock();
    }

    _buildHeader() {
        const header = new St.BoxLayout({style_class: 'np-card np-header', x_expand: true});
        this.add_child(header);

        const clockBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._clockArea = new DotArea(CLOCK_WIDTH, CLOCK_HEIGHT, cr => this._paintClock(cr), {style_class: 'np-clock'});
        this._dateLabel = new St.Label({style_class: 'np-date'});
        this._zoneLabel = new St.Label({style_class: 'np-zone'});
        clockBox.add_child(this._clockArea);
        clockBox.add_child(this._dateLabel);
        clockBox.add_child(this._zoneLabel);
        header.add_child(clockBox);

        this._weatherButton = new St.Button({style_class: 'np-weather', can_focus: true, y_align: Clutter.ActorAlign.CENTER});
        const weatherBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        this._weatherButton.set_child(weatherBox);
        this._weatherButton.connect('clicked', () => {
            this._weatherClient?.activateApp();
            Main.panel.closeCalendar();
        });
        const iconRow = new St.BoxLayout({style_class: 'np-weather-row', x_align: Clutter.ActorAlign.END});
        this._weatherIcon = new DotArea(9 * 5, 9 * 5, cr => drawDots(cr, WEATHER_ICONS[this._weatherKind], 0, 0, 5, 1.7),
            {style_class: 'np-weather-icon', y_align: Clutter.ActorAlign.CENTER});
        this._tempLabel = new St.Label({style_class: 'np-temp', y_align: Clutter.ActorAlign.CENTER});
        iconRow.add_child(this._weatherIcon);
        iconRow.add_child(this._tempLabel);
        this._conditionLabel = new St.Label({style_class: 'np-condition', x_align: Clutter.ActorAlign.END});
        this._conditionLabel.clutter_text.set({ellipsize: 0, line_wrap: true, line_alignment: 2});
        this._cityLabel = new St.Label({style_class: 'np-city', x_align: Clutter.ActorAlign.END});
        this._cityLabel.clutter_text.ellipsize = 0;
        weatherBox.add_child(iconRow);
        weatherBox.add_child(this._conditionLabel);
        weatherBox.add_child(this._cityLabel);
        header.add_child(this._weatherButton);
    }

    _statRow(name) {
        const row = new St.BoxLayout({style_class: 'np-stat-row', x_expand: true});
        row.add_child(new St.Label({text: name, style_class: 'np-stat-name', y_align: Clutter.ActorAlign.CENTER}));
        const value = new St.Label({style_class: 'np-stat-value', x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        return {row, value};
    }

    _buildStats() {
        const card = new St.BoxLayout({style_class: 'np-card np-stats', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.add_child(card);
        this._statLabels = {};

        for (const [key, name] of [['cpu', 'CPU'], ['ram', 'RAM'], ['disk', 'ДИСК']]) {
            const {row, value} = this._statRow(name);
            const bar = new DotArea(BAR_DOTS * 7, 7, cr => {
                const lit = Math.round(this._values[key] * BAR_DOTS);
                drawDots(cr, ['.'.repeat(BAR_DOTS)], 0, 0, 7, 2.2, x => x < lit);
            }, {style_class: 'np-bar', y_align: Clutter.ActorAlign.CENTER});
            row.insert_child_at_index(bar, 1);
            row.add_child(value);
            card.add_child(row);
            this._statLabels[key] = {bar, value};
        }

        const {row, value} = this._statRow('NET');
        this._spark = new DotArea(SPARK_COLUMNS * 4, SPARK_ROWS * 4, cr => {
            const history = this._stats.netHistory;
            const peak = Math.max(...history, 64 * 1024);
            const rows = [];
            for (let y = 0; y < SPARK_ROWS; y++)
                rows.push('.'.repeat(SPARK_COLUMNS));
            drawDots(cr, rows, 0, 0, 4, 1.3, (x, y) => {
                const level = history[x] > 0 ? Math.max(1, Math.round((history[x] / peak) * SPARK_ROWS)) : 0;
                return SPARK_ROWS - y <= level;
            });
        }, {style_class: 'np-spark', y_align: Clutter.ActorAlign.CENTER});
        row.insert_child_at_index(this._spark, 1);
        row.add_child(value);
        card.add_child(row);
        this._statLabels.net = {value};
    }

    _paintClock(cr) {
        const text = GLib.DateTime.new_now_local().format('%H%M%S');
        let x = 0;
        for (const glyph of [text[0], text[1], ':', text[2], text[3]]) {
            if (glyph === ':') {
                drawDots(cr, COLON, x, 0, CLOCK_PITCH, 2.6);
                x += CLOCK_PITCH * 2;
            } else {
                drawDots(cr, DIGITS[glyph], x, 0, CLOCK_PITCH, 2.6);
                x += CLOCK_PITCH * 6;
            }
        }
        x += SECONDS_GAP - CLOCK_PITCH;
        const top = CLOCK_HEIGHT - 7 * SECONDS_PITCH;
        drawDots(cr, DIGITS[text[4]], x, top, SECONDS_PITCH, 1.3);
        drawDots(cr, DIGITS[text[5]], x + SECONDS_PITCH * 6, top, SECONDS_PITCH, 1.3);
    }

    _refreshClock() {
        const now = GLib.DateTime.new_now_local();
        this._dateLabel.text = now.format('%A · %-d %B').toUpperCase();
        this._zoneLabel.text = zoneText(now);
        this._clockArea.queue_repaint();
    }

    _readWeather() {
        const client = this._weatherClient;
        const info = client?.info;
        if (!client?.available || !client.hasLocation || client.loading || !info?.is_valid())
            return null;

        const temp = info.get_temp_summary().replace(/\s*°\s*[CF]$/i, '°');
        if (!temp || temp === '-')
            return null;
        const conditions = info.get_conditions();
        let city = info.get_location_name?.() ?? '';
        try {
            city = this._weatherItem._findBestLocationName(info.location);
        } catch {}
        city = localCity(city, info.location);
        return {
            temp,
            condition: (conditions && conditions !== '-' ? conditions : info.get_sky()).toUpperCase(),
            city: city.toUpperCase(),
            kind: weatherKind(info.get_icon_name()),
        };
    }

    _syncWeather() {
        this._weatherItem?.hide();
        this._weatherButton.visible = !!this._weatherClient?.available;
        const weather = this._readWeather() ?? this._lastWeather;
        if (!weather) {
            this._tempLabel.text = '—';
            this._conditionLabel.text = this._weatherClient?.loading ? 'ЗАГРУЗКА' : 'НЕТ ДАННЫХ';
            this._cityLabel.text = '';
            return;
        }

        this._lastWeather = weather;
        this._tempLabel.text = weather.temp;
        this._conditionLabel.text = weather.condition;
        this._cityLabel.text = weather.city;
        if (this._weatherKind !== weather.kind) {
            this._weatherKind = weather.kind;
            this._weatherIcon.queue_repaint();
        }
    }

    _addPlayer(player) {
        if (this._cards.has(player))
            return;
        const card = new PlayerCard(player);
        this._cards.set(player, card);
        this._players.add_child(card);
        card.setActive(this._timer !== 0);
    }

    _removePlayer(player) {
        const card = this._cards.get(player);
        if (!card)
            return;
        player.disconnectObject(card);
        card.destroy();
        this._cards.delete(player);
    }

    _refreshStats() {
        const cpu = this._stats.cpuPercent();
        const mem = this._stats.memory();
        const net = this._stats.netSpeed();
        if (this._tick % DISK_EVERY_TICKS === 0)
            this._stats.refreshDisk();
        const disk = this._stats.disk;

        this._values.cpu = cpu / 100;
        this._values.ram = mem.total ? mem.used / mem.total : 0;
        this._values.disk = disk?.size ? 1 - disk.free / disk.size : 0;

        this._statLabels.cpu.value.text = `${cpu}%`;
        this._statLabels.ram.value.text = `${formatGb(mem.used)} / ${formatGb(mem.total)} ГБ`;
        this._statLabels.disk.value.text = disk ? `${formatGb(disk.free)} ГБ свободно` : '—';
        this._statLabels.net.value.text = net >= 1024 ** 2
            ? `${(net / 1024 ** 2).toFixed(1)} МБ/с`
            : `${Math.round(net / 1024)} КБ/с`;

        for (const key of ['cpu', 'ram', 'disk'])
            this._statLabels[key].bar.queue_repaint();
        this._spark.queue_repaint();
    }

    _scheduleTick() {
        const msIntoSecond = Math.floor(GLib.get_real_time() / 1000) % 1000;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000 - msIntoSecond + 5, () => {
            this._tick++;
            this._refreshClock();
            this._refreshStats();
            this._scheduleTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    setOpen(open) {
        if (open && !this._timer) {
            this._tick = 0;
            const now = GLib.get_monotonic_time();
            if (now - this._lastWeatherUpdate > WEATHER_REFRESH_US) {
                this._lastWeatherUpdate = now;
                this._weatherClient?.update();
            }
            this._refreshClock();
            this._refreshStats();
            this._scheduleTick();
        } else if (!open && this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        for (const card of this._cards.values())
            card.setActive(open);
    }
});

const LockClock = GObject.registerClass(
class NothingLockClock extends St.BoxLayout {
    constructor() {
        super({
            style_class: 'np-lock-clock',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._timer = 0;
        this._clockArea = new DotArea(LOCK_WIDTH, LOCK_HEIGHT, cr => this._paint(cr), {
            style_class: 'np-clock',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._dateLabel = new St.Label({
            style_class: 'np-lock-date',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._zoneLabel = new St.Label({
            style_class: 'np-lock-zone',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        for (const label of [this._dateLabel, this._zoneLabel])
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.add_child(this._clockArea);
        this.add_child(this._dateLabel);
        this.add_child(this._zoneLabel);
        this.connect('destroy', () => this.stop());
    }

    _paintTime(cr, dx, dy, radiusScale, color) {
        const text = GLib.DateTime.new_now_local().format('%H%M');
        let x = dx;
        for (const glyph of [text[0], text[1], ':', text[2], text[3]]) {
            if (glyph === ':') {
                drawDots(cr, COLON, x, dy, LOCK_PITCH, LOCK_PITCH * 0.34 * radiusScale, null, color);
                x += LOCK_PITCH * 2;
            } else {
                drawDots(cr, DIGITS[glyph], x, dy, LOCK_PITCH, LOCK_PITCH * 0.34 * radiusScale, null, color);
                x += LOCK_PITCH * 6;
            }
        }
    }

    _paint(cr) {
        const width = this._clockArea.get_width() || LOCK_WIDTH;
        const dx = Math.max(0, Math.round((width - LOCK_WIDTH) / 2));
        this._paintTime(cr, dx, 1, 1.28, [0, 0, 0, 0.5, 0]);
        this._paintTime(cr, dx, 0, 1, [1, 1, 1, 1, 0.16]);
    }

    _refresh() {
        const now = GLib.DateTime.new_now_local();
        this._dateLabel.text = now.format('%A · %-d %B').toUpperCase();
        this._zoneLabel.text = zoneText(now);
        this._clockArea.queue_repaint();
    }

    start() {
        if (this._timer)
            return;
        this._refresh();
        const wait = 1000 - (Math.floor(GLib.get_real_time() / 1000) % 1000) + 5;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
            this._refresh();
            this._timer = 0;
            this.start();
            return GLib.SOURCE_REMOVE;
        });
    }

    stop() {
        if (!this._timer)
            return;
        GLib.source_remove(this._timer);
        this._timer = 0;
    }
});

export default class NothingPanelExtension extends Extension {
    enable() {
        this._sessionId = Main.sessionMode.connect('updated', () => this._syncSession());
        this._syncSession();
    }

    _syncSession() {
        const locked = Main.sessionMode.currentMode === 'unlock-dialog';
        if (locked) {
            if (!this._lockMode) {
                this._lockMode = true;
                this._enableLock();
            }
            return;
        }
        if (this._lockMode) {
            this._disableLock();
            this._lockMode = false;
        }
        if (!this._panel)
            this._enableCalendar();
    }

    _enableCalendar() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        const messageList = dateMenu._messageList;
        this._dateMenu = dateMenu;
        this._messageList = messageList;
        this._hbox = messageList.get_parent();
        this._index = this._hbox.get_children().indexOf(messageList);

        this._column = new St.BoxLayout({
            style_class: 'np-column',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this._panel = new NothingPanel(dateMenu);
        this._hbox.remove_child(messageList);
        this._column.add_child(this._panel);
        this._column.add_child(messageList);
        this._hbox.insert_child_at_index(this._column, this._index);

        const messageView = messageList._messageView;
        this._messageView = messageView;
        messageView?._mediaSource?.disconnectObject(messageView);
        for (const player of [...(messageView?._playerToMessage?.keys() ?? [])])
            messageView._removePlayer(player);

        dateMenu.menu.connectObject('open-state-changed', (_, open) => this._panel.setOpen(open), this);
        if (dateMenu.menu.isOpen)
            this._panel.setOpen(true);
    }

    _enableLock() {
        const dialog = Main.screenShield?._dialog;
        const clock = dialog?._clock;
        const notes = dialog?._notificationsBox;
        if (!clock || !notes || this._lockClock) {
            if (!this._lockShownId && !this._lockClock)
                this._lockShownId = Main.screenShield?.connect('lock-screen-shown', () => this._enableLock());
            return;
        }
        if (this._lockShownId) {
            Main.screenShield.disconnect(this._lockShownId);
            this._lockShownId = 0;
        }

        clock._time?.hide();
        clock._date?.hide();
        clock._hint?.hide();
        this._lockClock = new LockClock();
        dialog.add_child(this._lockClock);
        this._lockClock.start();
        this._lockPlaceId = this._lockClock.connect('notify::width', () => this._placeLockClock());
        this._lockMonitorId = Main.layoutManager.connect('monitors-changed', () => this._placeLockClock());
        this._lockAdjustId = dialog._adjustment?.connect('notify::value', () => this._fadeLockClock());
        this._placeLockClock();
        this._fadeLockClock();
        this._showLockScrim(dialog);

        this._lockNotes = notes;
        this._lockCards = new Map();
        const adopt = player => {
            notes._players.get(player)?.hide();
            if (this._lockCards.has(player))
                return;
            const card = new PlayerCard(player);
            notes._notificationBox.insert_child_at_index(card, 0);
            card.setActive(true);
            this._lockCards.set(player, card);
        };
        notes._mediaSource?.connectObject(
            'player-added', (_, player) => adopt(player),
            'player-removed', (_, player) => {
                this._lockCards.get(player)?.destroy();
                this._lockCards.delete(player);
            },
            this);
        notes._mediaSource?.players.forEach(player => adopt(player));
    }

    _placeLockClock() {
        const clock = this._lockClock;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!clock || !monitor)
            return;
        let width = clock.get_width();
        if (width < 10)
            [, width] = clock.get_preferred_width(-1);
        const x = monitor.x + Math.round((monitor.width - width) / 2);
        clock.set_position(x, monitor.y + 40);
    }

    _fadeLockClock() {
        const clock = this._lockClock;
        const progress = Main.screenShield?._dialog?._adjustment?.value ?? 0;
        if (!clock)
            return;
        clock.opacity = Math.round(255 * (1 - progress));
        clock.visible = progress < 0.98;
    }

    _showLockScrim(dialog) {
        if (this._lockScrim || !dialog?._backgroundGroup)
            return;
        this._lockScrim = new St.Widget({
            style: 'background-color: rgba(0, 0, 0, 0.44);',
            reactive: false,
        });
        dialog.insert_child_above(this._lockScrim, dialog._backgroundGroup);
        this._placeLockScrim();
        this._scrimId = Main.layoutManager.connect('monitors-changed', () => this._placeLockScrim());
    }

    _placeLockScrim() {
        if (!this._lockScrim)
            return;
        let x1 = 0;
        let y1 = 0;
        let x2 = 0;
        let y2 = 0;
        for (const monitor of Main.layoutManager.monitors) {
            x1 = Math.min(x1, monitor.x);
            y1 = Math.min(y1, monitor.y);
            x2 = Math.max(x2, monitor.x + monitor.width);
            y2 = Math.max(y2, monitor.y + monitor.height);
        }
        this._lockScrim.set_position(x1, y1);
        this._lockScrim.set_size(x2 - x1, y2 - y1);
    }

    _hideLockScrim() {
        if (this._scrimId) {
            Main.layoutManager.disconnect(this._scrimId);
            this._scrimId = 0;
        }
        this._lockScrim?.destroy();
        this._lockScrim = null;
    }

    _disableLock() {
        this._hideLockScrim();
        if (this._lockPlaceId) {
            this._lockClock?.disconnect(this._lockPlaceId);
            this._lockPlaceId = 0;
        }
        if (this._lockMonitorId) {
            Main.layoutManager.disconnect(this._lockMonitorId);
            this._lockMonitorId = 0;
        }
        if (this._lockAdjustId) {
            Main.screenShield?._dialog?._adjustment?.disconnect(this._lockAdjustId);
            this._lockAdjustId = 0;
        }
        this._lockNotes?._mediaSource?.disconnectObject(this);
        for (const [player, card] of this._lockCards ?? []) {
            card.destroy();
            this._lockNotes?._players.get(player)?.show();
        }
        this._lockCards = null;
        this._lockNotes = null;

        const clock = Main.screenShield?._dialog?._clock;
        this._lockClock?.destroy();
        this._lockClock = null;
        clock?._time?.show();
        clock?._date?.show();
        clock?._hint?.show();
    }

    disable() {
        if (this._sessionId) {
            Main.sessionMode.disconnect(this._sessionId);
            this._sessionId = 0;
        }
        if (this._lockShownId) {
            Main.screenShield?.disconnect(this._lockShownId);
            this._lockShownId = 0;
        }
        this._hideLockScrim();
        if (this._lockMode) {
            this._disableLock();
            this._lockMode = false;
        }
        if (!this._panel)
            return;
        this._dateMenu?.menu.disconnectObject(this);

        this._panel?.destroy();
        this._panel = null;

        if (this._column) {
            this._column.remove_child(this._messageList);
            this._column.destroy();
            this._column = null;
            this._hbox.insert_child_at_index(this._messageList, this._index);
        }

        this._messageView?._setupMpris?.();
        this._dateMenu?._weatherItem?._sync?.();

        this._messageView = null;
        this._messageList = null;
        this._hbox = null;
        this._dateMenu = null;
    }
}
