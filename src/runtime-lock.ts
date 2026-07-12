import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface RuntimeLockOptions {
  staleMilliseconds?: number;
  heartbeatMilliseconds?: number;
  electionMilliseconds?: number;
}

const defaultStaleMilliseconds = 15 * 60 * 1_000;
const defaultHeartbeatMilliseconds = 30 * 1_000;
const defaultElectionMilliseconds = 25;
const maximumChoosingWaitMilliseconds = 1_000;

export async function withRuntimeLock<T>(
  runtimeRoot: string,
  task: () => Promise<T>,
  options: RuntimeLockOptions = {}
): Promise<T> {
  const staleMilliseconds = options.staleMilliseconds ?? defaultStaleMilliseconds;
  const heartbeatMilliseconds = options.heartbeatMilliseconds ?? defaultHeartbeatMilliseconds;
  const electionMilliseconds = options.electionMilliseconds ?? defaultElectionMilliseconds;
  const leasesRoot = path.join(runtimeRoot, "update-locks");
  await fs.mkdir(leasesRoot, { recursive: true });

  const leaseToken = crypto.randomUUID();
  const leasePath = path.join(leasesRoot, `${leaseToken}.lock`);
  const handle = await fs.open(leasePath, "wx", 0o600);
  try {
    // A bakery-style ticket avoids a shared stale lock that would require an
    // unsafe compare-and-delete. Late contenders observe this published ticket
    // and cannot overtake it; equal tickets are ordered by the unique token.
    await writeLease(handle, leaseToken, "choosing", 0);
    await new Promise((resolve) => setTimeout(resolve, electionMilliseconds));
    const ticket = await nextLeaseTicket(
      leasesRoot,
      leasePath,
      staleMilliseconds
    );
    await writeLease(handle, leaseToken, "waiting", ticket);
    const hasPriority = await waitForLeasePriority(
      leasesRoot,
      leasePath,
      leaseToken,
      ticket,
      staleMilliseconds
    );
    if (!hasPriority) {
      throw new Error("Another xaligo runtime update is already in progress.");
    }
    await writeLease(handle, leaseToken, "active", ticket);

    const heartbeat = setInterval(() => {
      const now = new Date();
      void fs.utimes(leasePath, now, now).catch(() => undefined);
    }, heartbeatMilliseconds);
    try {
      return await task();
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    await handle.close().catch(() => undefined);
    await fs.rm(leasePath, { force: true }).catch(() => undefined);
  }
}

async function nextLeaseTicket(
  leasesRoot: string,
  ownLeasePath: string,
  staleMilliseconds: number
): Promise<number> {
  const entries = await fs.readdir(leasesRoot, { encoding: "utf8", withFileTypes: true });
  let maximumTicket = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) {
      continue;
    }
    const leasePath = path.join(leasesRoot, entry.name);
    if (leasePath === ownLeasePath) {
      continue;
    }
    const lease = await readLease(leasePath, staleMilliseconds);
    if (!lease) {
      await fs.rm(leasePath, { force: true }).catch(() => undefined);
      continue;
    }
    maximumTicket = Math.max(maximumTicket, lease.ticket);
  }
  if (!Number.isSafeInteger(maximumTicket) || maximumTicket >= Number.MAX_SAFE_INTEGER) {
    throw new Error("The xaligo runtime update lock ticket is invalid.");
  }
  return maximumTicket + 1;
}

async function waitForLeasePriority(
  leasesRoot: string,
  ownLeasePath: string,
  ownToken: string,
  ownTicket: number,
  staleMilliseconds: number
): Promise<boolean> {
  const deadline = Date.now() + maximumChoosingWaitMilliseconds;
  while (true) {
    const decision = await inspectLeasePriority(
      leasesRoot,
      ownLeasePath,
      ownToken,
      ownTicket,
      staleMilliseconds
    );
    if (decision !== "wait") {
      return decision === "proceed";
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function inspectLeasePriority(
  leasesRoot: string,
  ownLeasePath: string,
  ownToken: string,
  ownTicket: number,
  staleMilliseconds: number
): Promise<"proceed" | "wait" | "reject"> {
  const entries = await fs.readdir(leasesRoot, { encoding: "utf8", withFileTypes: true });
  let choosing = false;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) {
      continue;
    }
    const leasePath = path.join(leasesRoot, entry.name);
    if (leasePath === ownLeasePath) {
      continue;
    }
    const lease = await readLease(leasePath, staleMilliseconds);
    if (!lease) {
      await fs.rm(leasePath, { force: true }).catch(() => undefined);
      continue;
    }
    if (lease.status === "choosing") {
      choosing = true;
      continue;
    }
    if (lease.status === "active") {
      return "reject";
    }
    if (
      lease.ticket < ownTicket ||
      (lease.ticket === ownTicket && lease.token < ownToken)
    ) {
      return "reject";
    }
  }
  return choosing ? "wait" : "proceed";
}

async function readLease(
  leasePath: string,
  staleMilliseconds: number
): Promise<{
  token: string;
  status: "choosing" | "waiting" | "active";
  ticket: number;
} | undefined> {
  const info = await fs.stat(leasePath).catch(() => undefined);
  if (!info) {
    return undefined;
  }
  const contents = await fs.readFile(leasePath, "utf8").catch(() => undefined);
  const fields = contents?.split("\n") ?? [];
  const ownerPid = Number.parseInt(fields[1] ?? "", 10);
  if (Date.now() - info.mtimeMs > staleMilliseconds && !isProcessAlive(ownerPid)) {
    return undefined;
  }
  const token = fields[0];
  const status = fields[3];
  const ticket = Number.parseInt(fields[4] ?? "", 10);
  if (
    !token ||
    !["choosing", "waiting", "active"].includes(status) ||
    !Number.isSafeInteger(ticket) ||
    ticket < 0
  ) {
    return { token: path.basename(leasePath), status: "choosing", ticket: 0 };
  }
  return { token, status: status as "choosing" | "waiting" | "active", ticket };
}

async function writeLease(
  handle: Awaited<ReturnType<typeof fs.open>>,
  leaseToken: string,
  status: "choosing" | "waiting" | "active",
  ticket: number
): Promise<void> {
  const contents = Buffer.from(
    `${leaseToken}\n${process.pid}\n${new Date().toISOString()}\n${status}\n${ticket}\n`,
    "utf8"
  );
  await handle.truncate(0);
  await handle.write(contents, 0, contents.length, 0);
  await handle.sync();
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
