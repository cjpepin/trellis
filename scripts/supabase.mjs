import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fromRepoRoot, repoRootDir } from "./lib/repo-paths.mjs";

const rootDir = repoRootDir;
const supabaseDir = fromRepoRoot("supabase");
const defaultTypesOutputPath = fromRepoRoot("src", "lib", "database.types.ts");
const flagsWithValues = new Set([
  "--db-url",
  "--dns-resolver",
  "--env-file",
  "--file",
  "--lang",
  "--name",
  "--network-id",
  "--output",
  "--out-file",
  "--password",
  "--profile",
  "--project-id",
  "--project-ref",
  "--query-timeout",
  "--schema",
  "--swift-access-control",
  "--token",
  "--workdir",
  "-f",
  "-o",
  "-p",
  "-s"
]);
const localSupabaseBinary = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.cmd" : "supabase"
);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const values = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function loadEnvironment() {
  const envPath = path.join(rootDir, ".env");
  const envLocalPath = path.join(rootDir, ".env.local");
  const merged = { ...parseEnvFile(envPath), ...parseEnvFile(envLocalPath) };

  for (const [key, value] of Object.entries(merged)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function splitArgs(args) {
  const positionals = [];
  const flags = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg.startsWith("-")) {
      flags.push(arg);

      if (!arg.includes("=") && flagsWithValues.has(arg)) {
        const value = args[index + 1];

        if (value && value !== "--") {
          flags.push(value);
          index += 1;
        }
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags };
}

function hasFlag(flags, ...names) {
  return flags.some((flag) => names.includes(flag));
}

function getFlagValue(flags, ...names) {
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (names.includes(flag)) {
      return flags[index + 1];
    }

    for (const name of names) {
      const prefix = `${name}=`;

      if (flag.startsWith(prefix)) {
        return flag.slice(prefix.length);
      }
    }
  }

  return undefined;
}

/** Edge Functions need `--env-file`; prefer `.env` when present so the file is usually complete. */
function getFunctionsEnvFile() {
  const envPath = path.join(rootDir, ".env");
  const envLocalPath = path.join(rootDir, ".env.local");

  if (fs.existsSync(envPath)) {
    return envPath;
  }
  if (fs.existsSync(envLocalPath)) {
    return envLocalPath;
  }
  return undefined;
}

function getProjectFlags() {
  return process.env.SUPABASE_PROJECT_REF
    ? ["--project-ref", process.env.SUPABASE_PROJECT_REF]
    : [];
}

function getDbPasswordFlags() {
  return process.env.SUPABASE_DB_PASSWORD
    ? ["--password", process.env.SUPABASE_DB_PASSWORD]
    : [];
}

function getProjectIdFlags() {
  return process.env.SUPABASE_PROJECT_REF
    ? ["--project-id", process.env.SUPABASE_PROJECT_REF]
    : [];
}

function listFunctionNames() {
  const functionsDir = path.join(supabaseDir, "functions");

  if (!fs.existsSync(functionsDir)) {
    return [];
  }

  return fs
    .readdirSync(functionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

function listMigrationNames() {
  const migrationsDir = path.join(supabaseDir, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
}

function getSupabaseCommand() {
  if (fs.existsSync(localSupabaseBinary)) {
    return localSupabaseBinary;
  }

  return "supabase";
}

function runSupabase(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(getSupabaseCommand(), args, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      if (error && error.code === "ENOENT") {
        reject(
          new Error(
            "Supabase CLI was not found. Install it globally or add it to this project before using these helpers."
          )
        );
        return;
      }

      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Supabase command failed with exit code ${code ?? 1}.`));
    });
  });
}

function runSupabaseCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(getSupabaseCommand(), args, {
      cwd: rootDir,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      if (error && error.code === "ENOENT") {
        reject(
          new Error(
            "Supabase CLI was not found. Install it globally or add it to this project before using these helpers."
          )
        );
        return;
      }

      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`Supabase command failed with exit code ${code ?? 1}.`));
    });
  });
}

async function runSequential(commands) {
  for (const command of commands) {
    console.log(`\n> supabase ${command.join(" ")}`);
    await runSupabase(command);
  }
}

async function handleDoctor() {
  const functionsEnvFile = getFunctionsEnvFile();
  const functionNames = listFunctionNames();
  const migrationNames = listMigrationNames();

  console.log("Supabase DX Doctor");
  console.log(`CLI source: ${fs.existsSync(localSupabaseBinary) ? "local" : "PATH"}`);
  console.log(`Functions env file: ${functionsEnvFile ?? "not found"}`);
  console.log(
    `Project ref: ${process.env.SUPABASE_PROJECT_REF ?? "not set (linked project or env required for remote actions)"}`
  );
  console.log(
    `Access token: ${process.env.SUPABASE_ACCESS_TOKEN ? "set" : "not set"}`
  );
  console.log(
    `DB password: ${process.env.SUPABASE_DB_PASSWORD ? "set" : "not set"}`
  );
  console.log(`Functions: ${functionNames.length > 0 ? functionNames.join(", ") : "none found"}`);
  console.log(`Migrations: ${migrationNames.length > 0 ? migrationNames.join(", ") : "none found"}`);
}

async function handleLink(args) {
  const { positionals, flags } = splitArgs(args);

  if (hasFlag(flags, "--help", "-h")) {
    await runSupabase(["link", ...flags]);
    return;
  }

  const ref = positionals[0] ?? process.env.SUPABASE_PROJECT_REF;

  if (!ref) {
    throw new Error("Missing project ref. Pass one explicitly or set SUPABASE_PROJECT_REF.");
  }

  await runSupabase(["link", "--project-ref", ref, ...flags]);
}

async function handleLogin(args) {
  const { flags } = splitArgs(args);
  const command = ["login"];

  if (!hasFlag(flags, "--token") && process.env.SUPABASE_ACCESS_TOKEN) {
    command.push("--token", process.env.SUPABASE_ACCESS_TOKEN);
  }

  await runSupabase([...command, ...flags]);
}

async function handleFunctionsServe(args) {
  const { positionals, flags } = splitArgs(args);
  const envFile = getFunctionsEnvFile();
  const functionName = positionals[0];
  const command = ["functions", "serve"];

  if (functionName) {
    command.push(functionName);
  }

  if (envFile && !flags.includes("--env-file")) {
    command.push("--env-file", envFile);
  }

  await runSupabase([...command, ...flags]);
}

async function handleFunctionsDeploy(args) {
  const { positionals, flags } = splitArgs(args);
  const targetFunctions = positionals.length > 0 ? positionals : listFunctionNames();

  if (targetFunctions.length === 0) {
    throw new Error("No edge functions were found to deploy.");
  }

  await runSequential(
    targetFunctions.map((functionName) => [
      "functions",
      "deploy",
      functionName,
      ...getProjectFlags(),
      ...flags
    ])
  );
}

async function handleDbPush(args) {
  const { flags } = splitArgs(args);
  await runSupabase(["db", "push", ...getDbPasswordFlags(), ...flags]);
}

async function handleDbReset(args) {
  const { flags } = splitArgs(args);
  await runSupabase(["db", "reset", ...flags]);
}

async function handleDbDiff(args) {
  const { positionals, flags } = splitArgs(args);

  if (hasFlag(flags, "--help", "-h")) {
    await runSupabase(["db", "diff", ...flags]);
    return;
  }

  const migrationName = positionals[0];

  if (!migrationName) {
    throw new Error("Missing migration name. Example: npm run supabase:db:diff -- add_profiles_index");
  }

  const command = ["db", "diff", "--file", migrationName];

  if (!hasFlag(flags, "--schema", "-s")) {
    command.push("--schema", "public,auth");
  }

  await runSupabase([...command, ...flags]);
}

async function handleMigrationNew(args) {
  const { positionals, flags } = splitArgs(args);

  if (hasFlag(flags, "--help", "-h")) {
    await runSupabase(["migration", "new", ...flags]);
    return;
  }

  const migrationName = positionals[0];

  if (!migrationName) {
    throw new Error("Missing migration name. Example: npm run supabase:migration:new -- add_profiles_index");
  }

  await runSupabase(["migration", "new", migrationName, ...flags]);
}

async function handleTypesGenerate(args) {
  const { flags } = splitArgs(args);
  const forwardedFlags = flags.filter((flag, index) => {
    const nextFlag = flags[index - 1];

    if (flag === "--stdout" || flag === "--out-file") {
      return false;
    }

    if (nextFlag === "--out-file") {
      return false;
    }

    return true;
  });

  if (hasFlag(flags, "--help", "-h")) {
    await runSupabase(["gen", "types", ...forwardedFlags]);
    return;
  }

  const stdoutMode = hasFlag(flags, "--stdout");
  const requestedOutputPath = getFlagValue(flags, "--out-file");
  const outputPath = requestedOutputPath
    ? path.resolve(rootDir, requestedOutputPath)
    : defaultTypesOutputPath;
  const command = ["gen", "types", "--lang", "typescript"];

  if (!hasFlag(forwardedFlags, "--local", "--linked", "--project-id", "--db-url")) {
    if (process.env.SUPABASE_PROJECT_REF) {
      command.push(...getProjectIdFlags());
    } else {
      command.push("--local");
    }
  }

  if (!hasFlag(forwardedFlags, "--schema", "-s")) {
    command.push("--schema", "public,auth");
  }

  const { stdout } = await runSupabaseCapture([...command, ...forwardedFlags]);

  if (stdoutMode) {
    process.stdout.write(stdout);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, stdout, "utf8");
  console.log(`Wrote generated types to ${path.relative(rootDir, outputPath)}.`);
}

async function handleBackendDeploy(args) {
  const { positionals, flags } = splitArgs(args);
  const skipDb = hasFlag(flags, "--skip-db");
  const skipFunctions = hasFlag(flags, "--skip-functions");
  const forwardedFlags = flags.filter(
    (flag) => flag !== "--skip-db" && flag !== "--skip-functions"
  );

  if (!skipDb) {
    await handleDbPush(forwardedFlags);
  }

  if (!skipFunctions) {
    await handleFunctionsDeploy([...positionals, ...forwardedFlags]);
  }
}

async function handlePassthrough(action, args) {
  const commands = {
    start: ["start"],
    stop: ["stop"],
    status: ["status"]
  };

  await runSupabase([...commands[action], ...args]);
}

async function main() {
  loadEnvironment();

  const [action, ...args] = process.argv.slice(2);
  const actionHandlers = {
    doctor: handleDoctor,
    link: handleLink,
    login: handleLogin,
    "functions:serve": handleFunctionsServe,
    "functions:deploy": handleFunctionsDeploy,
    "db:push": handleDbPush,
    "db:reset": handleDbReset,
    "db:diff": handleDbDiff,
    "migration:new": handleMigrationNew,
    "types:gen": handleTypesGenerate,
    "backend:deploy": handleBackendDeploy,
    start: (forwardedArgs) => handlePassthrough("start", forwardedArgs),
    stop: (forwardedArgs) => handlePassthrough("stop", forwardedArgs),
    status: (forwardedArgs) => handlePassthrough("status", forwardedArgs)
  };
  const knownActions = Object.keys(actionHandlers).join(", ");

  if (!action) {
    throw new Error(`Missing action. Try: ${knownActions}.`);
  }

  const actionHandler = actionHandlers[action];

  if (!actionHandler) {
    throw new Error(`Unknown action: ${action}. Try: ${knownActions}.`);
  }

  await actionHandler(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
