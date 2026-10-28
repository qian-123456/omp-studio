import { uncitedConditions } from "<HOME>/.agents/skills/statechart/scripts/lib.mjs";
import fs from "fs";
for (const f of fs.readdirSync("models").filter(f=>f.endsWith(".tla"))) {
  const r = uncitedConditions(fs.readFileSync("models/"+f,"utf8"));
  console.log(f, JSON.stringify(r));
}
