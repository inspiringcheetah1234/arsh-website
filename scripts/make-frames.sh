#!/usr/bin/env bash
# ARSH BY HZK — hero frame builder.
#
# Converts media/hero/hero-desktop.mp4 (16:9) and media/hero/hero-mobile.mp4 (9:16)
# into WebP sequences + a manifest the site reads at runtime:
#   public/assets/frames/desktop/0001.webp ... + manifest.json   (1920w)
#   public/assets/frames/mobile/0001.webp  ... + manifest.json   (900w)
#
# Swapping footage = replace the mp4s and re-run this script. Nothing else.
#
#   bash scripts/make-frames.sh              # default 220 frames
#   FRAMES=160 QUALITY=68 bash scripts/make-frames.sh
#   ONLY=mobile bash scripts/make-frames.sh   # rebuild just one set (after editing mobile-crop.json, delete media/hero/hero-mobile.mp4 first)
#
# Fallbacks:
#   - hero-desktop.mp4 missing -> a labelled TEST clip is generated (scripts/make-test-clip.mjs)
#   - hero-mobile.mp4 missing  -> derived from the desktop clip with a slow tracking 9:16 crop
#   - WebP encoder: cwebp -> ffmpeg libwebp -> sharp (node, scripts/node_modules)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERO="$ROOT/media/hero"
OUT="$ROOT/public/assets/frames"
FRAMES="${FRAMES:-220}"
QUALITY="${QUALITY:-66}"
DESKTOP_W="${DESKTOP_W:-1920}"
MOBILE_W="${MOBILE_W:-900}"

command -v ffmpeg >/dev/null || { echo "ffmpeg is required (brew install ffmpeg)"; exit 1; }

# 1. Source footage -----------------------------------------------------------
if [[ ! -f "$HERO/hero-desktop.mp4" ]]; then
  echo "! media/hero/hero-desktop.mp4 not found -> generating labelled TEST clip"
  node "$ROOT/scripts/make-test-clip.mjs" desktop "$HERO/hero-desktop.mp4"
fi

if [[ ! -f "$HERO/hero-mobile.mp4" ]]; then
  echo "! media/hero/hero-mobile.mp4 not found -> deriving a 9:16 crop from desktop"
  # The crop window follows the action along the keyframes in media/hero/mobile-crop.json
  # ([seconds, centre as a fraction of the frame width]); without that file it stays centred.
  # Or supply a real 9:16 cut as media/hero/hero-mobile.mp4 and none of this runs.
  if [[ -f "$HERO/mobile-crop.json" ]]; then
    CROP_X="$(python3 -I "$ROOT/scripts/crop-expr.py" "$HERO/mobile-crop.json")"
  else
    CROP_X="(iw-ow)/2"
  fi
  ffmpeg -v error -y -i "$HERO/hero-desktop.mp4" \
    -vf "crop=w=trunc(ih*9/16/2)*2:h=ih:x='${CROP_X}':y=0,scale=1080:1920:flags=lanczos" \
    -an -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p "$HERO/hero-mobile.mp4"
fi

# 2. Encoder choice -----------------------------------------------------------
ENCODER="sharp"
if command -v cwebp >/dev/null; then ENCODER="cwebp"
elif ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libwebp; then ENCODER="ffmpeg"; fi
if [[ "$ENCODER" == "sharp" && ! -d "$ROOT/scripts/node_modules/sharp" ]]; then
  echo "No WebP encoder found. Run: (cd scripts && npm install)  or  brew install webp"; exit 1
fi
echo "WebP encoder: $ENCODER"

# 3. Extract ------------------------------------------------------------------
build() { # name src width
  local name="$1" src="$2" width="$3"
  local dir="$OUT/$name" tmp
  tmp="$(mktemp -d)"
  local dur fps
  dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")"
  fps="$(awk -v n="$FRAMES" -v d="$dur" 'BEGIN{printf "%.5f", n/d}')"
  rm -rf "$dir"; mkdir -p "$dir"
  echo "-> $name: ${dur}s @ ${fps}fps -> $FRAMES frames, ${width}w"

  if [[ "$ENCODER" == "ffmpeg" ]]; then
    ffmpeg -v error -y -i "$src" -vf "fps=$fps,scale=$width:-2:flags=lanczos" \
      -frames:v "$FRAMES" -c:v libwebp -quality "$QUALITY" -compression_level 6 "$dir/%04d.webp"
  else
    ffmpeg -v error -y -i "$src" -vf "fps=$fps,scale=$width:-2:flags=lanczos" \
      -frames:v "$FRAMES" "$tmp/%04d.png"
    if [[ "$ENCODER" == "cwebp" ]]; then
      for f in "$tmp"/*.png; do cwebp -quiet -q "$QUALITY" -m 6 "$f" -o "$dir/$(basename "${f%.png}").webp"; done
    else
      node "$ROOT/scripts/to-webp.mjs" "$tmp" "$dir" "$QUALITY"
    fi
  fi
  rm -rf "$tmp"

  local count w h
  count="$(ls "$dir"/*.webp | wc -l | tr -d ' ')"
  local sw sh
  IFS=, read -r sw sh < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$src")
  w="$width"; h="$(awk -v a="$width" -v b="$sh" -v c="$sw" 'BEGIN{printf "%d", int(a*b/c/2+0.5)*2}')"
  cat > "$dir/manifest.json" <<JSON
{
  "count": $count,
  "width": $w,
  "height": $h,
  "pattern": "{n}.webp",
  "pad": 4,
  "poster": $(( count * 6 / 100 )),
  "v": "$(date +%s)",
  "source": "$(basename "$src")"
}
JSON
  echo "   $count frames, $(du -sh "$dir" | cut -f1)"
}

[[ "${ONLY:-}" == "mobile" ]]  || build desktop "$HERO/hero-desktop.mp4" "$DESKTOP_W"
[[ "${ONLY:-}" == "desktop" ]] || build mobile  "$HERO/hero-mobile.mp4"  "$MOBILE_W"
echo "Done. Frames in public/assets/frames/{desktop,mobile}."
