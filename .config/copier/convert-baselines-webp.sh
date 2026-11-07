#!/bin/sh
# 26.0.0: the visual helper 3 compares lossless WebP references. A PNG one
# left in place is recorded anew on the next run and its test passes without
# comparing anything. Convert each baseline folder of the project once, with
# the same pixels, using the storyboard version the project now pins.
set -eu

folders=$(find project -name '*.png' -path '*/screenshots/base/*' -not -path '*/node_modules/*' 2>/dev/null |
  sed 's|\(/screenshots/base\)/.*|\1|' | sort -u)
[ -n "$folders" ] || exit 0

version=$(sed -n 's|.*"@digital-commons-official/codeceptjs-storyboard": *"\([^"]*\)".*|\1|p' .config/codeceptjs/package.json)
for folder in $folders; do
  if command -v npx >/dev/null 2>&1; then
    npx -y -p "@digital-commons-official/codeceptjs-storyboard@$version" codeceptjs-storyboard-webp "$folder"
  else
    echo "[webp migration] Node.js is missing: convert the PNG baselines before the next test run with"
    echo "  npx -y -p @digital-commons-official/codeceptjs-storyboard@$version codeceptjs-storyboard-webp $folder"
  fi
done
