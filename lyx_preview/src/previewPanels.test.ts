import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreviewPanels } from "./previewPanels";

describe("split Preview panels", () => {
  it("retains file state until the final panel closes", () => {
    const panels = new PreviewPanels<object>();
    const first = {}, second = {};
    assert.equal(panels.add(first, "C:/docs/a.lyx"), true);
    assert.equal(panels.add(second, "C:\\docs\\a.lyx"), false);
    assert.equal(panels.remove(first), false);
    assert.equal(panels.find("C:/docs/a.lyx"), second);
    assert.equal(panels.remove(second), true);
    assert.equal(panels.find("C:/docs/a.lyx"), undefined);
    assert.equal(panels.remove(second), false);
  });

  it("targets the active split rather than a newly registered inactive split", () => {
    const panels = new PreviewPanels<object>();
    const first = {}, second = {};
    panels.add(first, "/docs/a.lyx");
    panels.activate(first);
    panels.add(second, "/docs/a.lyx");
    assert.equal(panels.find("/docs/a.lyx"), first);
    panels.activate(second);
    assert.equal(panels.active(), second);
    assert.equal(panels.find("/docs/a.lyx"), second);
    panels.deactivate(second);
    assert.equal(panels.active(), undefined);
    assert.equal(panels.find("/docs/a.lyx"), second);
    panels.remove(second);
    assert.equal(panels.find("/docs/a.lyx"), first);
  });

  it("keeps different files independent", () => {
    const panels = new PreviewPanels<object>();
    const first = {}, second = {};
    panels.add(first, "/docs/a.lyx");
    panels.add(second, "/docs/b.lyx");
    panels.activate(first);
    panels.activate(second);
    assert.equal(panels.find("/docs/a.lyx"), first);
    panels.remove(first);
    assert.equal(panels.active(), second);
    assert.equal(panels.find("/docs/b.lyx"), second);
  });
});
