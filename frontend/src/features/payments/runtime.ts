export type Runtime = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export function createWallRuntime(): Runtime {
  return {
    now: () => Date.now(),
    sleep: (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}

export function createVirtualRuntime(start = 0): Runtime {
  let time = start;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

export function createIdFactory(prefix = "pay"): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${sequence.toString()}`;
  };
}
