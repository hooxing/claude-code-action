/**
 * Check if the action trigger is from a human actor on Gitea.
 */

import type { GiteaClient } from "../api/client";
import type { GitHubContext } from "../../github/context";

export async function checkGiteaHumanActor(
  client: GiteaClient,
  githubContext: GitHubContext,
) {
  try {
    const userData = await client.getUser(githubContext.actor);

    // Gitea does not have a "type" field like GitHub.
    // We rely on the bot name convention and the allowed_bots list.
    const login = userData.login.toLowerCase();

    // If actor looks like a bot (contains "bot" in name) check allowed list
    const looksLikeBot = login.includes("bot") || login.endsWith("[bot]");

    if (looksLikeBot) {
      const allowedBots = githubContext.inputs.allowedBots;

      if (allowedBots.trim() === "*") {
        console.log(
          `All bots are allowed, skipping human actor check for: ${githubContext.actor}`,
        );
        return;
      }

      const allowedBotsList = allowedBots
        .split(",")
        .map((bot) =>
          bot
            .trim()
            .toLowerCase()
            .replace(/\[bot\]$/, ""),
        )
        .filter((bot) => bot.length > 0);

      const botName = login.replace(/\[bot\]$/, "");

      if (allowedBotsList.includes(botName)) {
        console.log(
          `Bot ${botName} is in allowed list, skipping human actor check`,
        );
        return;
      }

      throw new Error(
        `Workflow initiated by possible bot: ${githubContext.actor}. ` +
          `Add bot to allowed_bots list or use '*' to allow all bots.`,
      );
    }

    console.log(`Verified actor: ${githubContext.actor}`);
  } catch (error: any) {
    // If user lookup fails, allow the action to continue
    if (error.message?.includes("Workflow initiated by")) {
      throw error;
    }
    console.warn(
      `Could not verify actor type for ${githubContext.actor}: ${error.message}`,
    );
  }
}
