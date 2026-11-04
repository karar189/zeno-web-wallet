"use client";

import { useEffect, useState } from "react";
import {
  readPreferredNetwork,
  subscribePreferredNetwork,
  writePreferredNetwork,
  type PreferredNetwork,
} from "@/features/network/preference";

export function usePreferredNetwork(): {
  network: PreferredNetwork;
  setNetwork: (network: PreferredNetwork) => void;
  mainnet: boolean;
  mainnetPreview: boolean;
} {
  const [network, setNetworkState] = useState<PreferredNetwork>("testnet");

  useEffect(() => {
    setNetworkState(readPreferredNetwork());
    return subscribePreferredNetwork(setNetworkState);
  }, []);

  function setNetwork(next: PreferredNetwork) {
    setNetworkState(next);
    writePreferredNetwork(next);
  }

  return {
    network,
    setNetwork,
    mainnet: network === "mainnet",
    mainnetPreview: false,
  };
}
