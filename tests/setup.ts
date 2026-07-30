import { after } from "node:test";

import { dbService } from "../src/services/dbService.ts";

after(() => {
  try {
    dbService.stopAutoBackup();
  } catch {}

  try {
    dbService.closeDb();
  } catch {}
});
