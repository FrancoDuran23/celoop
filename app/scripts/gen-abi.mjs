// Regenerates src/lib/chain/abi.ts from the compiled interface (run `forge build` in ../contracts first).
import fs from "node:fs";
const out = "../contracts/out/ITreasuryPolicy.sol";
const abi = (name) => JSON.stringify(JSON.parse(fs.readFileSync(`${out}/${name}.json`, "utf8")).abi, null, 2);
fs.writeFileSync(
  "src/lib/chain/abi.ts",
  `// Generated from contracts/src/interfaces/ITreasuryPolicy.sol (forge build). Regenerate with: npm run abi
export const treasuryPolicyAbi = ${abi("ITreasuryPolicy")} as const;

export const boxFactoryAbi = ${abi("IBoxFactory")} as const;
`,
);
