const { createDatabase } = require("./database");

async function main() {
  const database = await createDatabase();

  console.log(`Database ready: ${database.databasePath || database.databaseUrl}`);
  console.log(
    JSON.stringify(
      {
        provider: database.provider,
        areas: (await database.listAreas()).length,
        stores: (await database.listStores()).length,
        events: await database.countEvents(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
