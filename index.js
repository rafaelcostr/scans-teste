const { mainCli } = require("./scanner");

mainCli().catch((err) => {
  console.error("Erro:", err.message || err);
  process.exitCode = 1;
});
