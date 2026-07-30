#!/usr/bin/env bash
# Собирает сайт в deploy/. Запускается GitHub Actions при каждом пуше в main,
# локально нужен только чтобы посмотреть результат до выкладки.
#
# Версия service worker штампуется временем сборки. Без этого после выкладки
# на устройствах осталась бы старая закэшированная копия, а понять это
# по внешнему виду невозможно — экран выглядит рабочим, просто старым.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/app"
out="$root/deploy"

rm -rf "$out"
mkdir -p "$out"

cp -r "$src/css" "$src/js" "$src/fonts" "$src/icons" "$src/data" "$out/"
cp "$src/index.html" "$src/manifest.webmanifest" "$src/sw.js" "$out/"
cp "$root/scripts/pages/README.md" "$out/"

# GitHub Pages по умолчанию прогоняет сайт через Jekyll, а тот пропускает
# файлы и папки, начинающиеся с подчёркивания. Пустой .nojekyll это отключает.
touch "$out/.nojekyll"

stamp="$(date -u +%Y%m%d-%H%M)"
sed -i.bak "s/^const VERSION = .*/const VERSION = '$stamp';/" "$out/sw.js"
rm -f "$out/sw.js.bak"

# Той же меткой штампуется build.js. Она видна в разделе диагностики, и это
# единственный способ понять с телефона, какая версия там открыта: по внешнему
# виду отличить сборки невозможно.
sed -i.bak "s/^export const BUILD = .*/export const BUILD = '$stamp';/" "$out/js/build.js"
rm -f "$out/js/build.js.bak"

grep -q "BUILD = '$stamp'" "$out/js/build.js" || { echo "ОШИБКА: метка сборки не проставилась" >&2; exit 1; }
grep -q "VERSION = '$stamp'" "$out/sw.js" || { echo "ОШИБКА: версия service worker не проставилась" >&2; exit 1; }

# Страховка на будущее: в data/ должны быть только вымышленные демо-данные.
# Если рядом когда-нибудь окажется файл с настоящими остатками, сборка
# должна упасть, а не выложить его в открытый доступ.
for stray in "$out"/data/*; do
  case "$(basename "$stray")" in
    demo.json) ;;
    *) echo "ОШИБКА: в сборку попал посторонний файл данных: $(basename "$stray")" >&2; exit 1 ;;
  esac
done

echo "Собрано в deploy/ — версия service worker $stamp"
du -sh "$out"
