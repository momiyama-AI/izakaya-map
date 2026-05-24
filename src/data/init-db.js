const { createDatabase } = require("./database");

const database = createDatabase();

console.log(`SQLite database ready: ${database.databasePath}`);
console.log(
  JSON.stringify(
    {
      areas: database.listAreas().length,
      stores: database.listStores().length,
      events: database.countEvents(),
    },
    null,
    2,
  ),
);

