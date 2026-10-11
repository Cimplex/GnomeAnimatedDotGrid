# Animated Dot Grid for GNOME Shell 50

A subtle animated dot grid rendered procedurally by a small GLSL fragment
shader. It is placed directly on the stage below GNOME Shell's UI and outside
its wallpaper and window groups, so it remains stationary during workspace
changes. The temporary wallpaper copies created by Shell's workspace-switch
animation are suppressed, and the grid is temporarily stacked above the real
window group so only Shell's animated window clones move over it. No video or
image assets are used.

## Install for development

```bash
make install
```

Then log out and back in (required on Wayland), and enable it:

```bash
gnome-extensions enable animated-dot-grid@local
```

Disable or uninstall with:

```bash
gnome-extensions disable animated-dot-grid@local
make uninstall
```

## Customize the appearance

Open the extension's preferences in the Extensions app, or run:

```bash
gnome-extensions prefs animated-dot-grid@local
```

Changes to dot color, spacing and size; moving-circle size, direction, count,
blur and speed; and the background color are applied live. Circle direction is
measured clockwise in screen coordinates, where 0° moves right and 90° moves
down. The default animation is capped at 24 FPS to reduce power use.

The optional overview integration keeps one continuous animated grid behind
workspace windows and the app grid. GNOME's workspace wallpaper actors are
hidden and both large-preview frame layers are disabled so neither can flash
through during state changes. Preview suppression runs before every Shell
paint, including gesture closing frames, independently of the 24 FPS shader
timer. Preview frame color transitions are disabled to avoid briefly painting
the theme's gray fallback. The small workspace thumbnails at the top keep
their normal backgrounds, borders, and selection state; window previews remain
fully opaque.

Check errors with:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

This version deliberately targets GNOME Shell 50. GNOME 51 removes
`Shell.GLSLEffect` and will require a small port to `Clutter.ShaderEffect`.
