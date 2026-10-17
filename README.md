# @cesarvenzac/closeup

Film any part of a web page in close-up, sharp at any size: photos and videos of an element or
a region, with a drawn macOS-like cursor that follows your mouse or plays a path you draw, on a
background, with click sounds.

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

Press the shortcut, point at an element (↑ and ↓ widen and narrow the pick) or draw a region,
choose a photo or a video, and press Record. Chrome asks once to share the tab. Options set the
shape (16:9, 1:1, 4:5, 9:16 or the pick's own), the room round the pick, a background (a colour,
a gradient or an image of your own) with inset, corners and shadow, the cursor, its click ring,
the sounds and the quality. They're kept in the browser.

## Scripts

The pen button (video only) opens the script editor on the stage, at the size the take is filmed:

- Click where the cursor starts, then each place it goes. A click makes a gentle arc, as a wrist
  moves; a drag pulls the curve's handles, as Figma's pen does. Drag points and handles to adjust
  them, ⌥ to break a handle's mirror, double-click a point to switch between handles and an arc.
- Each point moves there, clicks or types, after hovering a moment if you like, then rests. The
  pace is a hand's (Fitts's law, with minimum-jerk speed) unless you set it. Type clicks the point
  and types into the text field that click focused, a character at a time: put it on a field.
- A point is tied to the element it's placed on, so it follows that element if the layout moves.
- Preview plays it on the page without filming. Done saves it for this page and sets Moves to
  Script, so Record plays it and stops by itself. Undo, redo, import and export are in the bar.

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
    { "to": { "x": 600, "y": 300 }, "action": "type", "text": "Hello", "wait": 0.6 }
  ]
}
```

Points are in page pixels (as laid out, not enlarged); `on` names the element and where in its box
(0 to 1). Handles (`in`, `out`) are optional, relative to their point.

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
pick fills the window, so the browser draws it large at the screen's full resolution; the layout
doesn't change, only how big it's drawn. The tab is then captured (`getDisplayMedia`) and cropped
to the frame by Region Capture (`CropTarget`, `cropTo`), so Closeup's own controls, outside the
frame, never show. The real cursor would be drawn into the capture small and soft, so it's hidden
and a drawn one stands in. The frames are laid on their background in a canvas and recorded.

## Needs

A Chromium browser on a desktop (Chrome, Edge, Arc, Brave): Region Capture is Chromium's. Chrome
records H.264 MP4; other builds may record WebM. Styles from another site's stylesheets can't be
read, so their hover rules can't be copied; code that checks `event.isTrusted` ignores a script's
events. The page doesn't scroll during a take.

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
