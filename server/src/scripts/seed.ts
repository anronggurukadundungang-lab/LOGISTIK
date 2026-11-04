import { seedBase } from "../seed.ts";
import { closeDb } from "../db.ts";

const result = seedBase();
console.log(
  `Seed selesai. Admin baru dibuat: ${result.createdAdmin ? "ya" : "tidak"}.`,
);
closeDb();
