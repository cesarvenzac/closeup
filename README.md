# @cesarvenzac/closeup

Film any part of a web page in close-up, sharp at any size: photos and videos of an element or
a region, with a drawn macOS-like cursor that follows your mouse or plays a path you draw, a
camera that pans down the page as you scroll and can close in on each click, on a background, with
click sounds. Keep a take trimmed, at another speed, as a video or a GIF. The docs, with a set to
film, are at [cesarvenzac.com/closeup](https://cesarvenzac.com/closeup).

```sh
npm install @cesarvenzac/closeup
```

## Use

```ts
import { install } from "@cesarvenzac/closeup";

install(); // ⌥⇧C opens and closes it
```

Or load it only when it's wanted, on a shortcut of your own:

```ts
addEventListener("keydown", (event) => {
  if (event.code === "KeyC" && event.altKey && event.shiftKey) import("@cesarvenzac/closeup").then((closeup) => closeup.toggle());
});
```

Or open it on an element, ready to film, from a button of your own:

```ts
import { open } from "@cesarvenzac/closeup";

filmIt.addEventListener("click", () => open({ pick: document.querySelector("#demo") }));
```

Press the shortcut, point at an element (↑ and ↓ widen and narrow the pick) and click, or draw a
region, choose a photo or a video, and press Record (Capture for a photo). Chrome asks to share the
tab each time. Once picked, what the take will film is outlined, its shape and room included, and
everything else dimmed. The toolbar's Options set:

- Frame: the shape (16:9, 1:1, 4:5, 9:16 or the pick's own), the room round an element (a region
  is filmed as drawn), and for a video how close the camera comes on each click (off, 1.5× or 2×).
- Background: none, a colour, a gradient or an image of your own, with inset, corners and shadow.
- Cursor: for a video, who moves it (your mouse or a script); whether it's drawn (a script's always
  is), its click ring and its size.
- Recording, for a video: a countdown before a take by hand (3 seconds unless you change it), the
  clicks' sound, the tab's own sound, and the quality. For a photo, a timer instead.

They're kept in the browser, all but a background image, which is chosen again after a reload.

## While filming

- The camera, when it closes in, does so on each click inside the frame, the point clicked staying
  where it is, and draws back once nothing's been clicked or typed for a moment. While it's close it
  follows the pointer as a magnifier does: what's under the pointer is what was under it before.
- Scroll as you would, with the wheel, a trackpad or the keys that scroll: a part of the page that
  scrolls (a list, a code block) scrolls, and otherwise the camera pans down the page, as far as
  the page goes. The page itself never scrolls, so nothing jumps.
- In a take by hand, Pause and Resume sit beside Stop, above the frame; a paused stretch isn't
  recorded. A script's take plays through. Esc stops either.

## Keeping a take

The finished take plays in a sheet. A video can be trimmed (drag the yellow handles, or move them
with the arrow keys, a tenth of a second at a time or a second with Shift), played at 0.5×, 1×,
1.5× or 2×, and kept as a video or a GIF; the preview plays the part kept, at its speed. Download
saves it as kept, and your own actions get the video as kept.

- Trimmed or at another speed, a video is played through once at that speed and recorded again,
  its sound kept at its pitch: it takes as long as the trimmed take lasts.
- A GIF is 15 frames a second, up to 800 pixels wide, with one palette for the whole take (its most
  used colours exactly, a median cut of the rest) and only what changed stored in each frame, so a
  page that mostly holds still weighs little. It loops.
- Chrome records a fragmented MP4: no index of its samples, and a length of zero, which some players
  and editors trip on. Closeup rewrites it as a regular MP4 when the take stops: the same samples,
  not re-encoded, indexed, with its length.

## Scripts

Script the cursor, in the toolbar (video only, once something is picked), opens the script editor
on the stage, at the size the take is filmed:

- Click where the cursor starts, then each place it goes. A click makes a gentle arc, as a wrist
  moves; a drag pulls the curve's handles, as Figma's pen does. Drag points and handles to adjust
  them, ⌥ to break a handle's mirror, double-click a point to switch between handles and an arc.
- Each point moves there, clicks, types or scrolls (those three after hovering a moment if you
  like), then rests. The pace is a hand's (Fitts's law, with minimum-jerk speed) unless you set it. Type
  clicks the point and types into the text field that click focused, a character at a time: put it
  on a field. Scroll turns the wheel there: what scrolls under it scrolls, or the page, the cursor
  keeping still while the page moves under it. The editor shows the page as it is at the point
  chosen, scrolled as far as the points before scroll it, so the next point goes on what's shown.
- A point is tied to the element it's placed on, so it follows that element if the layout moves.
- Preview plays it on the page without filming. Every change is kept for this page as you make
  it, in the browser; Done leaves the editor and sets Moves to Script, so Record plays it and stops
  by itself. Undo, redo, import and export are in the bar: export the JSON to keep it with the page.
- With the camera set to close in, it does on each click and typing, landing as the cursor
  arrives; from one to the next nearby it glides, to one further away it draws back first, and it
  draws back at the end. The cursor travels the page, so it stays on what it's over meanwhile.

While a script plays, the page is told about every move and press as a mouse would tell it
(pointer and mouse events, focus), so its own code reacts: hover effects, menus, a character that
turns to look. CSS's `:hover` and `:active` only follow the real pointer, so every rule that uses
them is copied with an attribute in their place, and the attribute is set on what the cursor is
over. Your mouse is kept off the page meanwhile.

A script is plain JSON:

```json
{
  "version": 1,
  "start": { "x": 480, "y": 130 },
  "steps": [
    {
      "to": { "x": 450, "y": 110, "on": { "selector": "button.like", "u": 0.5, "v": 0.5 } },
      "action": "click",
      "hover": 0.4,
      "wait": 1
    },
    { "to": { "x": 600, "y": 300 }, "action": "type", "text": "Hello", "wait": 0.6 },
    { "to": { "x": 600, "y": 300 }, "action": "scroll", "scroll": 400, "wait": 0.5 }
  ]
}
```

Points are in page pixels (as laid out, not enlarged); `on` names the element and where in its box
(0 to 1). Handles (`in`, `out`) are optional, relative to their point. `scroll` is in page pixels,
down when positive. Scrolling came with version 2; a script that doesn't scroll is written as
version 1, which Closeup 0.x reads too.

## Your own actions

`addAction` puts a button of your own on the finished take, beside Download, to keep it somewhere:

```ts
import { addAction } from "@cesarvenzac/closeup";

addAction({
  label: "Save to library",
  icon: `<path d="M12 13v8"/><path d="m8 17 4-4 4 4"/>`, // optional: paths on a 24-unit grid
  when: (take) => take.kind === "video", // optional: which takes to offer it on
  async run(take, { progress }) {
    // take.blob, take.type, take.width, take.height, take.seconds, take.script
    await upload(take.blob, progress); // call progress(0…1) as it goes
    return "Saved."; // said when it's done; a thrown error's message is said instead
  },
});
```

The button counts up while it works and stays pressed once it's done. `addAction` returns what
takes it away again.

## How it stays sharp

A capture of a small part of the screen is small: a 120-pixel button filmed and enlarged is a
blur. Closeup enlarges the page first. A transform on `<body>` scales it round the pick until the
frame fills most of the window, so the browser draws it large at the screen's full resolution; the layout
doesn't change, only how big it's drawn. The tab is then captured (`getDisplayMedia`) and cropped
to the frame by Region Capture (`CropTarget`, `cropTo`), so Closeup's own controls, outside the
frame, never show. The real cursor would be drawn into the capture small and soft, so it's hidden
and a drawn one stands in. The frames are laid on their background in a canvas and recorded.
The camera works the same way: closing in enlarges the page further and panning moves it, a frame
at a time on a spring, so a close-up of a click is drawn as sharp as the rest, not blown up.

## Needs

A Chromium browser on a desktop (Chrome, Edge, Arc, Brave): Region Capture is Chromium's. Chrome
records H.264 MP4; other builds may record WebM. Styles from another site's stylesheets can't be
read, so their hover rules can't be copied; code that checks `event.isTrusted` ignores a script's
events. While the page is staged, the transform on `<body>` makes it the box that parts fixed to
the window are placed in: they sit where they would at the top of the page and move with the rest,
and a fixed part you pick is filmed where it's placed then.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run check # packed as npm publishes it, then installed and run as a user's would be
```

This repository is a copy. The package is developed inside the site it was made for, whose
repository is private, and every release copies it here and publishes it to npm from here, with
provenance. Issues are welcome; pull requests are read, and their changes made at the source.

## Licence

MIT
