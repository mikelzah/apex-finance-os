#!/usr/bin/env bash
# Прогон всех проверок. Запускается руками и из GitHub Actions.
#
# Проверки настоящие, а не поверхностные: приложение поднимается в браузере
# и с ним работают так же, как работает человек, — нажимают, вводят, читают
# то, что отрисовано. Поэтому нужен и статический сервер, и Chromium.
#
#   ./scripts/test.sh            — всё
#   ./scripts/test.sh xlsx spend — только эти (совпадение по имени файла)
#
# Два сервера, потому что проверок два рода. На 8899 отдаётся сам репозиторий:
# приложение открывается прямо из app/, без сборки. На 8900 — уже собранный
# сайт в подпапке /apex-finance-os/, как он лежит на GitHub Pages: путь
# в подпапке ломается иначе, чем в корне, и проверять это надо отдельно.

set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tests="$root/tests"
out="$tests/.out"
pages="$tests/.pages"

command -v node >/dev/null || { echo "ОШИБКА: нет node" >&2; exit 1; }
node -e "require('playwright')" 2>/dev/null || {
  echo "ОШИБКА: не установлен playwright — npm i" >&2; exit 1; }

# Где взять Chromium. В готовой среде он уже лежит, и качать его заново —
# это триста мегабайт впустую; если нет, playwright возьмёт свой.
if [ -x /opt/pw-browsers/chromium ]; then
  export CHROMIUM_PATH=/opt/pw-browsers/chromium
fi

rm -rf "$out"
mkdir -p "$out" "$pages"

echo "Собираю сайт для проверок публикации…"
"$root/scripts/build-pages.sh" >/dev/null
rm -rf "$pages/apex-finance-os"
cp -r "$root/deploy" "$pages/apex-finance-os"

# Занятый порт молча отдаёт чужое содержимое, и проверки начинают врать:
# сборка на экране оказывается не той, которую только что собрали. Ошибку
# такого рода ищут долго и не там, поэтому проверяем заранее.
for port in 8899 8900; do
  if curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:$port/" 2>/dev/null; then
    echo "ОШИБКА: порт $port уже занят — остановите то, что на нём слушает" >&2
    exit 1
  fi
done

# Сервера поднимаем сами и сами же гасим: проверка, которая требует
# отдельно запущенного сервера, рано или поздно запускается без него
# и падает не по делу.
python3 -m http.server 8899 --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
app_pid=$!
python3 -m http.server 8900 --bind 127.0.0.1 --directory "$pages" >/dev/null 2>&1 &
pages_pid=$!
trap 'kill $app_pid $pages_pid 2>/dev/null' EXIT

for _ in $(seq 1 40); do
  curl -sf -o /dev/null http://127.0.0.1:8899/app/index.html && break
  sleep 0.25
done

shopt -s nullglob
files=()
if [ $# -gt 0 ]; then
  for mask in "$@"; do
    for f in "$tests"/*"$mask"*.js; do files+=("$f"); done
  done
else
  files=("$tests"/*.js)
fi

failed=()
passed=0
started=$SECONDS

for f in "${files[@]}"; do
  name="$(basename "$f")"
  log="$out/${name%.js}.log"
  if timeout 300 node "$f" >"$log" 2>&1; then
    passed=$((passed + 1))
    printf "  ok   %s\n" "$name"
  else
    failed+=("$name")
    printf "  FAIL %s\n" "$name"
    # Показываем только сами провалы: полный вывод лежит в логе рядом.
    grep -E "FAIL|провал|Error|исключение" "$log" | head -6 | sed 's/^/       /'
    printf "       весь вывод: tests/.out/%s.log\n" "${name%.js}"
  fi
done

echo
echo "Прошло: $passed · Провалов: ${#failed[@]} · $((SECONDS - started)) с"
[ ${#failed[@]} -eq 0 ] || { printf 'Упало: %s\n' "${failed[*]}"; exit 1; }
