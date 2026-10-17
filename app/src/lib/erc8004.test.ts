import { beforeEach, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { resetEnv } from "@/lib/env";
import {
  agentCardFromEnv,
  agentCardUri,
  CELO_MAINNET_IDENTITY_REGISTRY,
  CELO_SEPOLIA_IDENTITY_REGISTRY,
  registrationFile,
} from "./erc8004";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

beforeEach(() => resetEnv({ CHAIN: "local", ATTRIBUTION_CODE: "", APP_URL: "http://localhost:3000" }));

test("the card uses APP_URL and leaves registrations empty until AGENT_ID is set", () => {
  resetEnv({
    CHAIN: "mainnet",
    APP_URL: "https://minga.example/",
    ATTRIBUTION_CODE: "celo_97a761e4eeab",
    AGENT_PRIVATE_KEY: KEY,
    TELEGRAM_BOT_USERNAME: "@Minga_coop_bot",
  });
  const card = agentCardFromEnv("treasurer");
  const agent = privateKeyToAccount(KEY).address;
  expect(card.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  expect(card.image).toBe("https://minga.example/og.jpg");
  expect(card.services).toContainEqual({ name: "web", endpoint: "https://minga.example/" });
  expect(card.services).toContainEqual({ name: "telegram", endpoint: "https://t.me/Minga_coop_bot" });
  expect(card.services).toContainEqual({ name: "agentWallet", endpoint: `eip155:42220:${agent}` });
  expect(card.registrations).toEqual([]);
  expect(card.supportedTrust).toEqual(["reputation"]);
  expect(card["x-attribution"]).toEqual(["celo_97a761e4eeab"]);
  expect(card.x402Support).toBe(false);
  expect(agentCardUri("https://minga.example/", "treasurer")).toBe("https://minga.example/agent.json");
});

test("AGENT_ID and AUDITOR_ID fill the registration, on the chain the env selects", () => {
  resetEnv({
    CHAIN: "sepolia",
    APP_URL: "https://minga.example",
    AUDITOR_ADDRESS: "0x00000000000000000000000000000000000000a1",
    AUDITOR_ID: "42",
    AUDITOR_NAME: "Auditor de prueba",
  });
  const card = agentCardFromEnv("auditor");
  expect(card.name).toBe("Auditor de prueba");
  expect(card.registrations).toEqual([
    { agentId: 42, agentRegistry: `eip155:11142220:${CELO_SEPOLIA_IDENTITY_REGISTRY}` },
  ]);
  expect(card.services).toContainEqual({
    name: "agentWallet",
    endpoint: "eip155:11142220:0x00000000000000000000000000000000000000a1",
  });
});

test("mainnet registration points at the Celo Identity Registry", () => {
  const file = registrationFile({
    name: "Minga",
    description: "tesorero",
    appUrl: "https://minga.example",
    agent: "0x00000000000000000000000000000000000000b2",
    chainId: 42220,
    registry: CELO_MAINNET_IDENTITY_REGISTRY,
    agentId: BigInt(7),
  });
  expect(file.registrations).toEqual([
    { agentId: 7, agentRegistry: `eip155:42220:${CELO_MAINNET_IDENTITY_REGISTRY}` },
  ]);
  expect(CELO_MAINNET_IDENTITY_REGISTRY).toBe("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
});
