import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function addSpin(group, settings, key, title, lower, upper, step, digits = 0) {
    const adjustment = new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10});
    const spin = new Gtk.SpinButton({adjustment, digits, valign: Gtk.Align.CENTER});
    const row = new Adw.ActionRow({title});
    row.add_suffix(spin);
    row.activatable_widget = spin;
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
}

function addColor(group, settings, key, title) {
    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(key));
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog(),
        rgba,
        valign: Gtk.Align.CENTER,
    });
    button.connect('notify::rgba', () => {
        const color = button.rgba;
        const hex = `#${[color.red, color.green, color.blue]
            .map(channel => Math.round(channel * 255).toString(16).padStart(2, '0'))
            .join('')}`;
        settings.set_string(key, hex);
    });
    const row = new Adw.ActionRow({title});
    row.add_suffix(button);
    row.activatable_widget = button;
    group.add(row);
}

export default class AnimatedDotGridPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const dots = new Adw.PreferencesGroup({title: 'Dots'});
        addColor(dots, settings, 'dot-color', 'Color');
        addSpin(dots, settings, 'dot-spacing', 'Spacing (px)', 4, 100, 1, 1);
        addSpin(dots, settings, 'dot-size', 'Size (px)', 1, 30, 0.5, 1);
        page.add(dots);

        const circles = new Adw.PreferencesGroup({
            title: 'Circles',
            description: 'Moving fields that illuminate the dot grid',
        });
        addSpin(circles, settings, 'circle-size', 'Size (px)', 10, 1000, 5);
        addSpin(circles, settings, 'circle-direction', 'Direction (degrees)', 0, 359, 1);
        const randomRow = new Adw.SwitchRow({title: 'Random direction'});
        settings.bind('random-direction', randomRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        circles.add(randomRow);
        addSpin(circles, settings, 'circle-count', 'Count', 1, 12, 1);
        addSpin(circles, settings, 'circle-blur', 'Blur (px)', 0, 500, 1);
        addSpin(circles, settings, 'circle-speed', 'Speed (px/s)', 0, 1000, 5);
        page.add(circles);

        const background = new Adw.PreferencesGroup({title: 'Background'});
        addColor(background, settings, 'background-color', 'Color');
        page.add(background);

        const overview = new Adw.PreferencesGroup({
            title: 'Overview',
            description: 'Show the animated grid behind solid workspace backgrounds',
        });
        const overviewRow = new Adw.SwitchRow({title: 'Apply to GNOME overview'});
        settings.bind('apply-to-overview', overviewRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        overview.add(overviewRow);
        const debugRow = new Adw.SwitchRow({
            title: 'Debug overview transitions',
            subtitle: 'Show the shader marker and write state changes to the journal',
        });
        settings.bind('debug-transitions', debugRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        overview.add(debugRow);
        page.add(overview);

        window.add(page);
        window.set_default_size(560, 720);
    }
}
