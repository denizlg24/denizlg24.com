import { expect, test } from "bun:test";
import {
  type AgentInstructionsOptions,
  buildAgentInstructions,
} from "./instructions";

const options: AgentInstructionsOptions = {
  timeZone: "Europe/Copenhagen",
  executionMode: "interactive",
  pageTools: false,
  sandbox: false,
  connectors: { names: [], guidance: [], unavailable: [] },
};

test("voice turns request a spoken result after silent tool activity", () => {
  const voice = buildAgentInstructions({ ...options, responseStyle: "voice" });
  const chat = buildAgentInstructions(options);
  expect(voice).toContain("Call tools without a spoken progress preamble");
  expect(voice).toContain("Treat tool results as information to explain");
  expect(voice).toContain("there is no fixed sentence or length limit");
  expect(voice).toContain("read the requested text faithfully");
  expect(voice).not.toContain("Be concise");
  expect(voice).not.toContain("Use markdown when it helps");
  expect(chat).not.toContain("Call tools without a spoken progress preamble");
});
