import type { z } from "zod";
import type {
  changeStatusSchema,
  etfHoldingSchema,
  etfHoldingsSchema,
  execCompSchema,
  execPaySchema,
  filingRefSchema,
  holderSchema,
  institutionalHoldersSchema,
  managerChangesSchema,
  managerHitSchema,
  managerHoldingsSchema,
  managerRefSchema,
  parsedFilingSchema,
  payVersusPerformanceSchema,
  positionChangeSchema,
  positionSchema,
} from "./schemas";

export type Position = z.infer<typeof positionSchema>;
export type FilingRef = z.infer<typeof filingRefSchema>;
export type ParsedFiling = z.infer<typeof parsedFilingSchema>;
export type ManagerRef = z.infer<typeof managerRefSchema>;
export type ManagerHoldings = z.infer<typeof managerHoldingsSchema>;
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
export type PositionChange = z.infer<typeof positionChangeSchema>;
export type ManagerChanges = z.infer<typeof managerChangesSchema>;
export type ManagerHit = z.infer<typeof managerHitSchema>;
export type Holder = z.infer<typeof holderSchema>;
export type InstitutionalHolders = z.infer<typeof institutionalHoldersSchema>;
export type ExecPay = z.infer<typeof execPaySchema>;
export type PayVersusPerformance = z.infer<typeof payVersusPerformanceSchema>;
export type ExecComp = z.infer<typeof execCompSchema>;
export type EtfHolding = z.infer<typeof etfHoldingSchema>;
export type EtfHoldings = z.infer<typeof etfHoldingsSchema>;
