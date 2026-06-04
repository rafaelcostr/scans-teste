/**
 * Um passo do executor: POST /api/executor/tick com EXECUTOR_API_KEY.
 * Requer servidor a correr (npm start) e scan em cache (GET /api/scan).
 *
 * Env: EXECUTOR_BASE_URL (default http://127.0.0.1:PORT), EXECUTOR_API_KEY, PORT
 */

const axios = require("axios");

async function main() {
  const base = (
    process.env.EXECUTOR_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || "3000"}`
  ).replace(/\/$/, "");
  const key = process.env.EXECUTOR_API_KEY && String(process.env.EXECUTOR_API_KEY).trim();
  if (!key) {
    console.error("Defina EXECUTOR_API_KEY no ambiente.");
    process.exit(1);
  }
  const url = `${base}/api/executor/tick`;
  try {
    const res = await axios.post(
      url,
      {},
      {
        timeout: 30000,
        headers: {
          "Content-Type": "application/json",
          "X-Executor-Key": key
        },
        validateStatus: () => true
      }
    );
    console.log(JSON.stringify(res.data, null, 2));
    if (res.status < 200 || res.status >= 300) {
      process.exit(1);
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

main();
