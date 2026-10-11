UUID := animated-dot-grid@local
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall pack

install:
	mkdir -p "$(DEST)"
	cp extension.js prefs.js metadata.json stylesheet.css "$(DEST)/"
	mkdir -p "$(DEST)/schemas"
	cp schemas/*.xml "$(DEST)/schemas/"
	glib-compile-schemas "$(DEST)/schemas"

uninstall:
	rm -rf "$(DEST)"

pack:
	gnome-extensions pack --force .
