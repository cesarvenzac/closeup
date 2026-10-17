// The package as someone installing it uses it: typechecked against its published types (as
// NodeNext and as a bundler resolves them) and run, by check/run.sh. Filming needs a browser, so
// in Node it only loads (as a server render would), reads a script and says it can't film.
import { addAction, parseScript, supportsCapture, type Script, type Take, type TakeAction } from "@cesarvenzac/closeup";

const keep: TakeAction = {
  label: "Keep",
  when: (take: Take) => take.kind === "video",
  async run(take, { progress }) {
    progress(1);
    return `Kept ${take.width}×${take.height}.`;
  },
};
const remove = addAction(keep);
remove();

const script: Script | null = parseScript({
  version: 1,
  start: { x: 480, y: 130 },
  steps: [{ to: { x: 450, y: 110, on: { selector: "button.like", u: 0.5, v: 0.5 } }, action: "click", wait: 1 }],
});

if (!script || script.steps.length !== 1 || script.steps[0].action !== "click") throw new Error("a script didn't read back");
if (parseScript({ version: 2 }) !== null) throw new Error("an unknown script version was read");
if (supportsCapture()) throw new Error("Node can't film, yet it says it can");
console.log("ok", JSON.stringify(script.steps[0].to));
