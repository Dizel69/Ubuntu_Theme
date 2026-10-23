# Ubuntu Theme

Серая оболочка для Ubuntu 26.04 с GNOME Shell 50. Сначала ставится чужая тема и чужие расширения, потом скрипт из этого репозитория докладывает свой код и включает вид.

Проверено на GNOME Shell 50. На другой версии оболочки свои расширения могут не включиться.

## Что лежит в репозитории

Свой код:

- `extensions/` — панель календаря, трей, полоска у дока, сворачивание в иконку, уведомления справа
- `shell/gnome-shell.css` — оформление оболочки, в том числе экран блокировки
- `gtk/nautilus-frost.css` — чуть более прозрачные «Файлы»
- `icons/Yaru-grey-folders/` — серые значки папок поверх Yaru
- `profile/` — цвета, док, блюр, обои, список расширений
- `bin/look` — переключение между этим видом и обычным Ubuntu
- `nautilus/scripts/` — сценарии «Файлов»
- `install.sh` — ставит всё перечисленное

Чужое сюда не скопировано: тема MacTahoe, Blur My Shell, Flourish, виджеты рабочего стола и User Themes. Их ставят отдельно, команды ниже.

## 1. Чужое

### Тема окон и оболочки

MacTahoe основана на WhiteSur и публикуется под лицензией MIT: [vinceliuice/MacTahoe-gtk-theme](https://github.com/vinceliuice/MacTahoe-gtk-theme).

```bash
sudo apt install git sassc libglib2.0-dev-bin
git clone --depth 1 https://github.com/vinceliuice/MacTahoe-gtk-theme.git
cd MacTahoe-gtk-theme
./install.sh -c dark -t grey --shell -l
```

После этого должна появиться папка `~/.themes/MacTahoe-Dark-grey`, а в `~/.config/gtk-4.0` — файлы `gtk.css`. Ключ `-l` нужен для приложений вроде «Файлов» и «Параметров». Ключ `--shell` кладёт стили оболочки, которые следующий шаг заменит нашими.

Тему экрана входа (GDM) ставить не нужно. Этот репозиторий её не оформляет.

### Иконки

Обычные значки берутся из Yaru, он уже есть в Ubuntu. Серые папки ставятся своим шагом и наследуют `Yaru-dark`.

### Расширения

На Ubuntu уже стоят Ubuntu Dock, значки рабочего стола (DING) и Tiling Assistant.

Остальное ставится через приложение «Расширения» (`sudo apt install gnome-shell-extension-manager`) или с [extensions.gnome.org](https://extensions.gnome.org). Версия оболочки должна быть 50.

| Расширение | UUID |
| --- | --- |
| User Themes | `user-theme@gnome-shell-extensions.gcampax.github.com` |
| Blur my Shell | `blur-my-shell@aunetx` |
| Flourish | `flourish@orsso.github.io` |
| Desktop Widgets | `widgets@distro.com` |

Их можно пока не включать. `install.sh` включит нужный набор сам.

### По желанию

```bash
sudo apt install gnome-sushi python3-pil libreoffice
```

`gnome-sushi` открывает файл по пробелу в «Файлах». Pillow и LibreOffice нужны только сценарию «Конвертировать в PDF».

## 2. Своё

```bash
git clone https://github.com/Dizel69/Ubuntu_Theme.git
cd Ubuntu_Theme
./install.sh
```

Скрипт копирует расширения, подменяет `gnome-shell.css` внутри уже установленной MacTahoe, ставит серые папки, дописывает стекло «Файлов», включает профиль и команду `look`.

Дальше нужно выйти из сессии и зайти снова. Оболочка читает новый код расширений при входе. «Файлы» после этого тоже лучше закрыть и открыть заново.

Пока сессия не перезапущена, часть вида уже видна, а часы блокировки, трей и панель календаря — после входа.

### Команда look

- `look` — что включено сейчас
- `look custom` — снова серый вид
- `look standard` — обычный Ubuntu: тема Yaru, док и блюр по умолчанию, свои расширения выключены

`look standard` не удаляет MacTahoe из `~/.themes`. Он только перестаёт её использовать.

## Как этим пользоваться

- Календарь вверху справа открывает панель с точечными часами, погодой, плеерами и загрузкой машины. Город погоды берётся из приложения «Погода».
- Win+L показывает те же часы на экране блокировки. Экран ввода пароля и экран входа до сессии остаются системными.
- Значок в трее прячется, если перетащить его на стрелку.
- Полоска вокруг дока красится под цвет активного окна. Сама плашка с иконками не красится.
- Окно сворачивается в свою иконку на доке.
- В «Файлах» меню «Сценарии»: закрепить папку слева, скопировать путь, открыть терминал, открыть в Cursor, сохранить PDF рядом с файлом.

Виджеты на рабочем столе расставлены под один экран. Их можно перетащить.

## Лицензии

Код расширений, `install.sh`, `look` и сценарии «Файлов» — MIT, файл `LICENSE`.

`shell/gnome-shell.css` — изменённая таблица стилей GNOME Shell. В начале файла лицензия LGPL-2.1. Файл подменяет одноимённый файл из MacTahoe, саму тему MacTahoe этот репозиторий не содержит.

`icons/Yaru-grey-folders` — перекрас значков папок Yaru. Yaru распространяется под GPL-3, текст лежит в `icons/Yaru-grey-folders/COPYING`.

## English

This is a grey GNOME Shell 50 look for Ubuntu 26.04. Install the upstream pieces first, then run `./install.sh` from this repo.

1. Install [MacTahoe](https://github.com/vinceliuice/MacTahoe-gtk-theme) (MIT, based on WhiteSur):

```bash
sudo apt install git sassc libglib2.0-dev-bin
git clone --depth 1 https://github.com/vinceliuice/MacTahoe-gtk-theme.git
cd MacTahoe-gtk-theme
./install.sh -c dark -t grey --shell -l
```

Do not theme the GDM login screen.

2. From [extensions.gnome.org](https://extensions.gnome.org), for shell 50, install User Themes, Blur my Shell (`blur-my-shell@aunetx`), Flourish (`flourish@orsso.github.io`) and Desktop Widgets (`widgets@distro.com`). Ubuntu Dock, DING and Tiling Assistant already ship with Ubuntu.

3. Clone this repo and run `./install.sh`. Log out and back in.

`look standard` returns the stock Ubuntu look. `look custom` turns this one back on.

Original code in this repo is MIT. `shell/gnome-shell.css` stays under LGPL-2.1. The grey folder icons are a Yaru recolor under GPL-3.
