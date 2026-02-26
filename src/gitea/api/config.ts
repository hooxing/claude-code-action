/**
 * Gitea API configuration.
 *
 * GITEA_API_URL  – full base URL of the Gitea REST API, e.g.
 *                  https://gitea.example.com/api/v1
 *                  Falls back to GITHUB_API_URL (Gitea Actions sets this)
 *                  then to https://gitea.com/api/v1.
 *
 * GITEA_SERVER_URL – root URL of the Gitea web UI, e.g.
 *                    https://gitea.example.com
 *                    Falls back to GITHUB_SERVER_URL then https://gitea.com.
 */

export const GITEA_API_URL =
  process.env.GITEA_API_URL ||
  process.env.GITHUB_API_URL ||
  "https://gitea.com/api/v1";

export const GITEA_SERVER_URL =
  process.env.GITEA_SERVER_URL ||
  process.env.GITHUB_SERVER_URL ||
  "https://gitea.com";
