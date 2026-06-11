"use client";

import { getAge } from "@/lib/utils";

export default function CurrentAge() {
  return <>{getAge("2004-04-24")}</>;
}
