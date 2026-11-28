// Generate public learning facts from actual storage configuration, never secrets.
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  source = fs.readFileSync(path.join(root, "apps/api/src/storage.ts"), "utf8");
const read = (name) => {
  const expression = new RegExp("export const " + name + " = ([0-9 *]+);").exec(
    source,
  )?.[1];
  if (!expression)
    throw Error("Storage documentation generator cannot read " + name);
  return expression
    .split("*")
    .reduce((value, factor) => value * Number(factor.trim()), 1);
};
const config = {
  fileMiB: read("FILE_LIMIT") / 1048576,
  studentMiB: read("USER_BYTES") / 1048576,
  retentionDays: read("DOCUMENT_TTL") / 86400,
};
const count = /storage_state!='deleted'\)<(\d+)/.exec(source)?.[1];
if (!count) throw Error("Cannot read current document-count quota");
config.maxFiles = Number(count);
fs.writeFileSync(
  path.join(root, "shared/learning-config.ts"),
  "// Generated from apps/api/src/storage.ts by generate-learning-config.cjs.\nexport const documentLearningLimits = " +
    JSON.stringify(config) +
    " as const;\n",
);
