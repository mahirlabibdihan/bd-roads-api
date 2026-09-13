const { UpstreamGate } = require("../utils/upstreamGate");

test("bounds concurrency through body consumption and releases successful work", async () => {
  const gate = new UpstreamGate({ concurrency: 1, cooldownMs: 1000 });
  let finish;
  const active = gate.run(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const extra = jest.fn();
  await expect(gate.run(extra)).rejects.toMatchObject({ status: 503, retryAfter: 1 });
  expect(extra).not.toHaveBeenCalled();
  finish("done");
  await expect(active).resolves.toBe("done");
  await expect(gate.run(() => "next")).resolves.toBe("next");
});

test("blocks retries after failure, recovers after cooldown, and ignores client errors", async () => {
  let now = 0;
  const gate = new UpstreamGate({ concurrency: 1, cooldownMs: 1000, now: () => now });
  await expect(
    gate.run(() => {
      throw Object.assign(new Error("no match"), { status: 422 });
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    gate.run(() => {
      throw new Error("timeout");
    }),
  ).rejects.toMatchObject({ retryAfter: 1 });
  await expect(gate.run(() => "early")).rejects.toMatchObject({ status: 503 });
  now = 1001;
  await expect(gate.run(() => "recovered")).resolves.toBe("recovered");
});
