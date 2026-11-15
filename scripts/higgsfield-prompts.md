# Hero footage — Higgsfield prompts (Part B)

Scroll scrubbing needs **one continuous move**. Generate it as three chained shots with an image-to-video model
that accepts a start frame and an end frame. Generate the keyframes first. Reuse the last frame of each shot as
the first frame of the next. Then join the shots and reframe them with ffmpeg.

> The current hero clip is the 32 s brand cut: red space, the ship with the Arsh script on its hull, the cargo bay opening, the stamp-style Lahore-to-Rome box released and burning into a comet, then a whiteout to cream. It already follows the structure below, so the site works now. The earlier midnight-blue-box clips are in `media/hero/previous/`. Use this file to regenerate or extend the footage.

## Consistency rules

- **One ship reference image** goes into every shot's reference slot. The ship should be an original
  design: utilitarian, matte grey, modular. Do not model it on any film's ship.
- **One box reference image** (a plain kraft mailer box, matte, with one small Orbit Red `#F23B35` mark on a Ticket Cream `#F6ECE1` label on the lid; this is the Mailer Box in the brand guidelines) goes into
  shots 2 and 3. It is the same object as the packaging in The Box section.
- Keep the same aspect ratio (16:9) and resolution (1920 × 1080 or higher) for every shot.

**Shared style line — append to every prompt:**

> cinematic IMAX 70mm realism, practical-effects feel, deep black space, restrained colour, subtle film grain, anamorphic lens flare used sparingly, slow deliberate camera, no text, no logos, no people.

## Keyframe stills (generate first, text-to-image, 16:9)

1. **K1 — ship above Earth.** A lone utilitarian matte-grey modular spacecraft, small in frame, upper left, drifting through a dense field of stars and faint nebula; the curve of Earth along the bottom of frame, thin blue atmospheric glow, city lights on the night side. + style line
2. **K2 — bay open, box emerging.** Closer on the same spacecraft's underside, a cargo bay open with warm interior light; a small plain kraft mailer box with a small red mark on a cream label on its lid floating just clear of the bay; Earth filling the lower background. + style line
3. **K3 — box at the atmosphere.** The same kraft box alone, tumbling gently, at the bright blue edge of Earth's atmosphere, seen from slightly above and behind, edges just beginning to glow. + style line
4. **K4 — comet mid-descent.** The box fully ignited into a champagne-gold comet with a long luminous gold and amber tail (not an orange fireball), streaking diagonally down toward the night side of Earth. + style line
5. **K5 — whiteout.** A pure, flat warm-white frame, exactly `#F6ECE1` (Ticket Cream), no texture. Make this one in any editor rather than generating it:
   `ffmpeg -f lavfi -i color=c=0xF6ECE1:s=1920x1080 -frames:v 1 k5.png`

## Shots (image-to-video, start → end frame)

**Shot 1: ship and Earth. ~6 s. Start K1 → end K2.**
> Wide shot of a lone, utilitarian, matte grey modular spacecraft drifting slowly through a rich galaxy of stars and faint nebula. The curve of Earth slowly rises along the bottom of frame with a thin blue atmospheric glow and city lights on the night side. Slow lateral camera drift, the ship passes left to right. Scale feels vast and silent. + style line

**Shot 2: the release. ~5 s. Start = last frame of Shot 1 → end K3.**
> Closer on the same spacecraft's underside. A cargo bay opens and releases a small plain kraft mailer box with a small red mark on a cream label on its lid, floating clear and starting to tumble gently. Camera follows the box as it leaves the ship, Earth filling the background below. + style line

**Shot 3: fall, comet, impact. ~6 s. Start = last frame of Shot 2 → end K5.**
> The same box falls toward Earth, accelerating. It meets the atmosphere, edges glow, it ignites and transforms into a champagne-gold comet with a long luminous tail (gold and amber, not orange fireball). Camera follows from behind, then the comet strikes Earth in a soft bloom that blows out to pure warm white in the final frames. + style line

If the model drifts off the end frame, generate K4 as a midpoint and split Shot 3 into two (K3 → K4 and K4 → K5).

## Chain, join, reframe (ffmpeg)

```bash
# Last frame of a shot -> start frame of the next
ffmpeg -sseof -0.05 -i shot1.mp4 -frames:v 1 -update 1 shot1_last.png
ffmpeg -sseof -0.05 -i shot2.mp4 -frames:v 1 -update 1 shot2_last.png

# Normalise all shots to the same size/fps, drop each joining duplicate frame, concatenate
for i in 1 2 3; do
  ffmpeg -y -i shot$i.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24" \
    -an -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p n$i.mp4
done
ffmpeg -y -i n1.mp4 -i n2.mp4 -i n3.mp4 -filter_complex \
  "[1:v]trim=start_frame=1,setpts=PTS-STARTPTS[b];[2:v]trim=start_frame=1,setpts=PTS-STARTPTS[c];[0:v][b][c]concat=n=3:v=1[v]" \
  -map "[v]" -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p assets/hero/hero-desktop.mp4

# Mobile 9:16: delete any old hero-mobile.mp4 and make-frames.sh derives a tracking crop automatically,
# or supply your own reframed 1080x1920 cut as assets/hero/hero-mobile.mp4.

# Rebuild the frame sequences the site reads
bash scripts/make-frames.sh
```

## After swapping the footage

Re-check the overlay timings in `data/config.json` → `hero.beats`. The quiet line, the letterbox release and
the whiteout are all keyed to scroll progress (0–1), so if the box ignites later or earlier in the new cut,
shift those numbers to match.
