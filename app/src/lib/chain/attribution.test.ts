import { encodeFunctionData } from "viem";
import { beforeEach, expect, test } from "vitest";
import { resetEnv } from "@/lib/env";
import { treasuryPolicyAbi } from "./abi";
import { attributionCode, readAttribution, withAttribution } from "./attribution";

beforeEach(() => resetEnv({ CHAIN: "local", ATTRIBUTION_CODE: "" }));

test("tagged calldata decodes back to the code", () => {
  resetEnv({ ATTRIBUTION_CODE: "celo_test123" });
  const data = encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "pause" });
  expect(readAttribution(withAttribution(data))).toEqual(["celo_test123"]);
});

test("mainnet without a code refuses", () => {
  resetEnv({ CHAIN: "mainnet", ATTRIBUTION_CODE: "" });
  expect(() => attributionCode()).toThrow(/ATTRIBUTION_CODE/);
});
