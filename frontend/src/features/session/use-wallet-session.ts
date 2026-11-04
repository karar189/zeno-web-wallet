"use client";

import { useSyncExternalStore } from "react";
import {
  getWalletSessionServerSnapshot,
  getWalletSessionSnapshot,
  subscribeWalletSession,
} from "./store";

export function useWalletSession() {
  return useSyncExternalStore(
    subscribeWalletSession,
    getWalletSessionSnapshot,
    getWalletSessionServerSnapshot,
  );
}
