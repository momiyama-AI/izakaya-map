const { createDatabase } = require("../src/data/database");
const { importNakanoSourceBackedPrices } = require("../src/data/nakano-source-import");

async function main() {
  const database = await createDatabase({ seedCuratedImports: false });
  const result = await importNakanoSourceBackedPrices(database);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
