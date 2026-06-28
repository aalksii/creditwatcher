import { renderDashboard } from "../dashboard/terminal.js";
import { getQuota } from "../server/quota.js";

export async function dashboardCommand(
  options: { force?: boolean } = {},
): Promise<void> {
  const quota = await getQuota({ force: options.force });
  console.log(renderDashboard(quota));

  const anyConnected =
    quota.codex.status !== "not_connected" ||
    quota.claude.status !== "not_connected" ||
    quota.cursor.status !== "not_connected";

  if (!anyConnected) {
    process.exitCode = 1;
  }
}
