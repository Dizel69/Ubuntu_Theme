// Wayland only lets a focused window set the clipboard, so a tiny window
// shows briefly; mutter keeps the text after the window closes.
imports.gi.versions.Gtk = '4.0';
const {Gtk, GLib} = imports.gi;

const text = ARGV[0] ?? '';
const app = new Gtk.Application({application_id: 'local.dizel.CopyPath'});

app.connect('activate', () => {
    const win = new Gtk.Window({
        application: app,
        title: 'Путь скопирован',
        default_width: 320,
        resizable: false,
    });
    const shown = text.split('\n').length > 1 ? `Скопировано путей: ${text.split('\n').length}` : text;
    win.set_child(new Gtk.Label({
        label: shown,
        ellipsize: 2,
        max_width_chars: 48,
        margin_top: 18,
        margin_bottom: 18,
        margin_start: 18,
        margin_end: 18,
    }));
    win.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        win.get_clipboard().set(text);
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1100, () => {
        win.close();
        return GLib.SOURCE_REMOVE;
    });
});

app.run([]);
