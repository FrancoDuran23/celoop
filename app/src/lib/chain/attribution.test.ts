import { toDataSuffix, withAttribution as tagWallet } from "@celo/attribution-tags";
import { encodeDeployData, encodeFunctionData, parseAbi, type Hex } from "viem";
import { beforeEach, expect, test } from "vitest";
import { resetEnv } from "@/lib/env";
import { treasuryPolicyAbi } from "./abi";
import { attributionCode, HACKATHON_ATTRIBUTION_CODE, readAttribution, withAttribution } from "./attribution";

beforeEach(() => resetEnv({ CHAIN: "local", ATTRIBUTION_CODE: "" }));

test("tagged calldata decodes back to the code", () => {
  resetEnv({ ATTRIBUTION_CODE: "celo_test123" });
  const data = encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "pause" });
  expect(readAttribution(withAttribution(data))).toEqual(["celo_test123"]);
});

test("the hackathon code is a suffix on pause calldata and on deployment init code", () => {
  resetEnv({ ATTRIBUTION_CODE: HACKATHON_ATTRIBUTION_CODE });
  const pause = encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "pause" });
  const tagged = withAttribution(pause);
  expect(tagged.endsWith(toDataSuffix(HACKATHON_ATTRIBUTION_CODE).slice(2))).toBe(true);
  expect(readAttribution(tagged)).toEqual([HACKATHON_ATTRIBUTION_CODE]);

  const initCode = encodeDeployData({
    abi: parseAbi(["constructor(address agent)"]),
    bytecode: "0x6080604052348015600e57600080fd5b50600a8061001d6000396000f3fe6080604052600080fdfe",
    args: ["0x0000000000000000000000000000000000000001"],
  });
  const deployed = withAttribution(initCode);
  expect(deployed.startsWith(initCode)).toBe(true);
  expect(readAttribution(deployed)).toEqual([HACKATHON_ATTRIBUTION_CODE]);
});

test("the wallet-client extension tags sendTransaction data and writeContract dataSuffix", async () => {
  resetEnv({ ATTRIBUTION_CODE: HACKATHON_ATTRIBUTION_CODE });
  const seen: { data?: Hex; dataSuffix?: Hex }[] = [];
  const actions = tagWallet(HACKATHON_ATTRIBUTION_CODE)({
    async sendTransaction(args: { data?: Hex }) {
      seen.push(args);
      return "0x1";
    },
    async writeContract(args: { dataSuffix?: Hex }) {
      seen.push(args);
      return "0x1";
    },
  });
  const pause = encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "pause" });
  await actions.sendTransaction({ data: pause });
  expect(readAttribution(seen[0].data!)).toEqual([HACKATHON_ATTRIBUTION_CODE]);
  expect(seen[0].data!.startsWith(pause)).toBe(true);

  await actions.writeContract({});
  expect(readAttribution(seen[1].dataSuffix!)).toEqual([HACKATHON_ATTRIBUTION_CODE]);

  // Already-tagged calldata is merged, not doubled.
  seen.length = 0;
  await actions.sendTransaction({ data: withAttribution(pause) });
  expect(readAttribution(seen[0].data!)).toEqual([HACKATHON_ATTRIBUTION_CODE]);
});

test("mainnet without a code refuses", () => {
  resetEnv({ CHAIN: "mainnet", ATTRIBUTION_CODE: "" });
  expect(() => attributionCode()).toThrow(/ATTRIBUTION_CODE/);
});
