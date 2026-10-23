#!/usr/bin/env bash
# Ставит эту сборку поверх уже установленной темы MacTahoe-Dark-grey.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME="${HOME}/.themes/MacTahoe-Dark-grey"
DATA="${HOME}/.local/share/ubuntu-theme"
EXT_DEST="${HOME}/.local/share/gnome-shell/extensions"
GTK4="${HOME}/.config/gtk-4.0"
FROST_MARK="Files window: sidebar and folder view share one slightly frosted fill."

if [[ ! -d "${THEME}/gnome-shell" ]]; then
  echo "Сначала поставь чужую тему MacTahoe-Dark-grey." >&2
  echo "Команды есть в README, раздел «1. Чужое»." >&2
  exit 1
fi

if ! compgen -G "${GTK4}/gtk*.css" > /dev/null; then
  echo "В ${GTK4} нет gtk.css." >&2
  echo "Поставь MacTahoe ещё раз с ключом -l, чтобы появился слой libadwaita." >&2
  exit 1
fi

mkdir -p "${DATA}/nautilus" "${HOME}/.local/bin" "${HOME}/.local/share/nautilus/scripts" "${HOME}/.local/share/icons"

for uuid in \
  nothing-panel@dizel.local \
  nothing-tray@dizel.local \
  dock-tone@dizel.local \
  mac-scale@dizel.local \
  mac-notify@dizel.local
do
  rm -rf "${EXT_DEST}/${uuid}"
  mkdir -p "${EXT_DEST}/${uuid}"
  cp -a "${REPO}/extensions/${uuid}/." "${EXT_DEST}/${uuid}/"
done

cp -a "${REPO}/shell/gnome-shell.css" "${THEME}/gnome-shell/gnome-shell.css"

rm -rf "${HOME}/.local/share/icons/Yaru-grey-folders"
mkdir -p "${HOME}/.local/share/icons/Yaru-grey-folders"
cp -a "${REPO}/icons/Yaru-grey-folders/." "${HOME}/.local/share/icons/Yaru-grey-folders/"
rm -f "${HOME}/.local/share/icons/Yaru-grey-folders/icon-theme.cache"
gtk-update-icon-cache -f "${HOME}/.local/share/icons/Yaru-grey-folders" >/dev/null 2>&1 || true

shopt -s nullglob
for css in "${GTK4}"/gtk*.css; do
  if ! grep -q "${FROST_MARK}" "${css}"; then
    printf '\n' >> "${css}"
    cat "${REPO}/gtk/nautilus-frost.css" >> "${css}"
  fi
done
shopt -u nullglob

rm -rf "${DATA}/profile" "${DATA}/nautilus"
mkdir -p "${DATA}/nautilus"
cp -a "${REPO}/profile" "${DATA}/profile"
cp -a "${REPO}/nautilus/copy-path.js" "${DATA}/nautilus/copy-path.js"
cp -a "${REPO}/nautilus/scripts/." "${HOME}/.local/share/nautilus/scripts/"
chmod +x "${HOME}/.local/share/nautilus/scripts/"* "${DATA}/nautilus/copy-path.js"

install -m 755 "${REPO}/bin/look" "${HOME}/.local/bin/look"

"${HOME}/.local/bin/look" custom

echo
echo "Сборка поставлена."
echo "Выйди из сессии и зайди снова: оболочка читает новые расширения только при входе."
echo "Потом «Файлы» нужно закрыть и открыть заново."
echo "Вернуть обычный Ubuntu: look standard"
