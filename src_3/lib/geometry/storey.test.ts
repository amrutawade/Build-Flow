import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saneStoreyHeight } from "./storey";

describe("saneStoreyHeight", () => {
  it("rejects 0 so walls can extrude", () => {
    assert.equal(saneStoreyHeight(0), 3);
    assert.equal(saneStoreyHeight(NaN), 3);
    assert.equal(saneStoreyHeight(2.7), 2.7);
  });
});
