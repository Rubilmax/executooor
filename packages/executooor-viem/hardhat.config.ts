import "@nomicfoundation/hardhat-viem";
import "evm-maths";
import "hardhat-deal";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import "solidity-coverage";

export { default } from "../../hardhat.config";

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, parse } from "path";
import { inspect } from "util";
import { TASK_COMPILE_SOLIDITY_EMIT_ARTIFACTS } from "hardhat/builtin-tasks/task-names";
import { subtask } from "hardhat/config";

subtask(TASK_COMPILE_SOLIDITY_EMIT_ARTIFACTS).setAction(async (args, _, next) => {
  const output = await next();

  await Promise.all(
    Object.entries(args.output.contracts).map(async ([sourceName, contract]) => {
      if (sourceName.includes("interfaces")) return;

      const source = parse(sourceName).name;
      const path = join("src", "contracts", `${source}.ts`);

      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const {
        // @ts-ignore
        abi,
        // @ts-ignore
        evm: {
          bytecode: { object: bytecode },
        },
      } = Object.entries(contract as {}).find(([name]) => name === source)![1];

      writeFileSync(
        path,
        `export const executorAbi = ${inspect(abi, false, null)} as const;
  
  export const bytecode = "0x${bytecode}";`,
      );
    }),
  );

  return output;
});
