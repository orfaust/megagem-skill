import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// The old localization helper only composed the removed deferred banner; no production caller remains.
test("obsolete banner module cannot introduce an input gate or advertise obsolete keys", () => {
  const dir = join(import.meta.dirname, "..", "extensions");
  for (const name of ["banner-text.ts", "pending-notice.ts", "feedback-guard.ts", "megagem-feedback.ts"]) {
    const source = readFileSync(join(dir, name), "utf8");
    assert.doesNotMatch(source, /onTerminalInput|Press Enter|Ctrl\+X|pressEnter|createPendingNotices|createDeferredDelivery/);
  }
});
