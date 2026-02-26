import { describe, test, expect } from "bun:test";
import {
  GITEA_DEFAULT_BOT_NAME,
  GITEA_DEFAULT_BOT_ID,
} from "../src/gitea/constants";

describe("Gitea constants", () => {
  test("default bot name is set", () => {
    expect(GITEA_DEFAULT_BOT_NAME).toBe("claude-bot");
  });

  test("default bot ID is set", () => {
    expect(GITEA_DEFAULT_BOT_ID).toBe(0);
  });
});
