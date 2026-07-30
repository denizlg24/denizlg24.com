import type { LucideIcon } from "lucide-react";
import {
  Brain,
  BrainCircuit,
  CircleDollarSign,
  Cpu,
  KeyRound,
  SlidersHorizontal,
} from "lucide-react";

/**
 * The global settings registry. Every section here is backed by the shared
 * AdminClient, so both apps render the identical rail. Host-specific sections
 * (desktop's device/update settings) are appended by the app through
 * `AdminSlots.settingsExtraSections` rather than living here.
 */
export interface SettingsSection {
  slug: string;
  label: string;
  icon: LucideIcon;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { slug: "general", label: "General", icon: SlidersHorizontal },
  { slug: "models", label: "Models", icon: Cpu },
  { slug: "triage", label: "Triage", icon: Brain },
  { slug: "agent-memory", label: "Agent memory", icon: BrainCircuit },
  { slug: "finance", label: "Finance", icon: CircleDollarSign },
  { slug: "tokens", label: "Tokens", icon: KeyRound },
];

export const DEFAULT_SETTINGS_SECTION = "general";
