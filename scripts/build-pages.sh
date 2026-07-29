#!/usr/bin/env bash
# Собирает содержимое публичного репозитория в deploy/.
#
# Главное, ради чего этот скрипт существует: из сборки выкидывается
# data/seed.json — там настоящие остатки счетов. В публичном репозитории
# этот файл окажется доступен всем и попадёт в поисковые индексы.
#
# Версия service worker штампуется датой и временем сборки: иначе после
# выкладки на телефонах останется старая закэшированная копия, а понять
# это по внешнему виду невозможно — экран выглядит рабочим, просто старым.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/app"
out="$root/deploy"

rm -rf "$out"
mkdir -p "$out"

cp -r "$src/css" "$src/js" "$src/fonts" "$src/icons" "$out/"
cp "$src/index.html" "$src/manifest.webmanifest" "$src/sw.js" "$out/"

mkdir -p "$out/data"
cp "$src/data/demo.json" "$out/data/"

# Файлы, которые нужны публичному репозиторию, но не самому приложению.
cp "$root/scripts/pages/README.md" "$out/"

# GitHub Pages по умолчанию прогоняет сайт через Jekyll, а тот пропускает
# файлы и папки, начинающиеся с подчёркивания. Пустой .nojekyll это отключает.
touch "$out/.nojekyll"

stamp="$(date -u +%Y%m%d-%H%M)"
sed -i.bak "s/^const VERSION = .*/const VERSION = '$stamp';/" "$out/sw.js"

# Личного слепка в сборке нет, поэтому его нужно убрать и из списка кэша:
# иначе service worker при установке ходит за несуществующим файлом и
# оставляет 404 в консоли при каждом первом запуске.
sed -i.bak "/data\/seed\.json/d" "$out/sw.js"

# И сказать приложению, что слепка нет, — иначе в настройках останется
# кнопка, ведущая в никуда.
sed -i.bak "s/^export const HAS_SEED = .*/export const HAS_SEED = false;/" "$out/js/config.js"

rm -f "$out/sw.js.bak" "$out/js/config.js.bak"

if [ -e "$out/data/seed.json" ]; then
  echo "ОШИБКА: личный слепок попал в сборку" >&2
  exit 1
fi

echo "Собрано в deploy/ — версия service worker $stamp"
du -sh "$out"
