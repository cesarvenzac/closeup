# Changelog

## 1.0.0

A camera that closes in on clicks, scrolling while you film, and takes you can trim, speed up and
keep as a GIF.

- **A camera.** Set Zoom in, under Frame, to 1.5× or 2×, and the camera closes in on each click
  inside the frame, the point clicked staying where it is. While close it follows the pointer, as
  a magnifier does, and it draws back once nothing's been clicked or typed for a moment. It
  enlarges the page further rather than the take, so a close-up is as sharp as the rest. Under
  reduced motion it cuts.
- **Scroll while filming.** With the wheel, a trackpad or the keys that scroll: a part of the page
  that scrolls (a list, a code block) scrolls, and otherwise the camera pans down the page. The
  page itself never scrolls, so nothing jumps.
- **Scripts that scroll.** A point can turn the wheel (`"action": "scroll"`, in page pixels), and
  the editor shows the page scrolled as far as the points before it. With the camera on, a
  script's clicks and typing close in, landing as the cursor arrives. The editor keeps every
  change as you make it.
- **Takes by hand.** A countdown before a video (3 seconds unless changed), a timer for a photo,
  and Pause and Resume beside Stop.
- **Keeping a take.** Trim it, play it at 0.5×, 1×, 1.5× or 2×, and keep it as a video or a GIF:
  15 frames a second, up to 800 pixels wide, with only what changed stored in each frame. Your own
  actions get the take as kept.
- **Regular MP4s.** Chrome records a fragmented MP4 with a length of zero, which some players and
  editors trip on. Closeup rewrites it as a regular one when the take stops: the same samples, not
  re-encoded, indexed, with its length.
- **The panel.** Its options in four groups (Frame, Background, Cursor, and Recording or Photo),
  and once something is picked, what the take will film outlined and the rest dimmed.
- **Fixed parts.** A part fixed to the window, picked on a scrolled page, is filmed where the
  stage places it, not where it had been.

### Upgrading from 0.2

Nothing to change: the API is the same. A script that scrolls is version 2 of the format; one
that doesn't is still written as version 1, which 0.x reads, and 0.x's scripts play as they did.
A video by hand now counts down 3 seconds first: set Countdown, under Recording, to Off to start
at once.

## 0.2.0

`open({ pick })` opens Closeup on an element of the page, ready to film, from a button of your
own.

## 0.1.1

No change to the code: the first version published through npm's trusted publishing, with
provenance.

## 0.1.0

The first release: photos and videos of an element or a region, sharp at any size, with a drawn
cursor that follows your mouse or plays a path you draw, on a background, with click sounds.
