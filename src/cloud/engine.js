import {
  clone,
  extract,
  queueDiff,
  acknowledge,
  applyRecords,
  resolveConflict,
} from "./model.js";
export class SyncEngine {
  constructor({
    read,
    write,
    remote,
    notify = () => {},
    uuid = () => crypto.randomUUID(),
    initial,
    guest,
  }) {
    Object.assign(this, { read, write, remote, notify, uuid, initial, guest });
    this.owner = read("active") || "guest";
    this.epoch = 0;
    this.busy = false;
    this.status = "local";
    this.error = "";
    this.timer = null;
    this.load();
  }
  load() {
    const saved = this.read(`account:${this.owner}`);
    this.snapshot = clone(saved?.snapshot || this.initial);
    this.meta = clone(
      saved?.meta || {
        revisions: {},
        pending: {},
        conflicts: {},
        lastSync: null,
      },
    );
    this.records = clone(saved?.records || []);
  }
  persist() {
    this.write(`account:${this.owner}`, {
      snapshot: this.snapshot,
      meta: this.meta,
      records: this.records,
    });
  }
  save(snapshot) {
    const before = extract(this.snapshot),
      after = extract(snapshot),
      changed = JSON.stringify(before) !== JSON.stringify(after);
    if (this.owner !== "guest" && changed)
      queueDiff(this.meta, before, after, this.uuid);
    this.snapshot = clone(snapshot);
    if (this.owner !== "guest" && changed && !this.busy)
      this.status = "pending";
    this.persist();
    this.emit();
    if (this.owner !== "guest" && changed) this.schedule();
  }
  emit() {
    this.notify({
      owner: this.owner,
      snapshot: this.snapshot,
      status: this.status,
      error: this.error,
      pending: Object.keys(this.meta.pending).length,
      conflicts: this.meta.conflicts,
      lastSync: this.meta.lastSync,
    });
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 4000);
  }
  async useAccount(uid) {
    clearTimeout(this.timer);
    this.epoch++;
    this.owner = uid;
    this.write("active", uid);
    this.load();
    this.status = "pending";
    this.error = "";
    this.emit();
    await this.sync();
  }
  useGuest() {
    clearTimeout(this.timer);
    this.epoch++;
    this.owner = "guest";
    this.write("active", "guest");
    this.load();
    this.status = "local";
    this.error = "";
    this.emit();
  }
  importGuest() {
    const snapshot = this.guest();
    if (!snapshot) return;
    const docs = extract(snapshot);
    queueDiff(this.meta, {}, docs, this.uuid);
    this.snapshot = applyRecords(
      this.snapshot,
      this.records,
      this.meta.pending,
    );
    this.status = "pending";
    this.persist();
    this.emit();
    this.schedule();
  }
  resolve(key, choice) {
    resolveConflict(this.meta, key, choice, this.uuid);
    this.snapshot = applyRecords(
      this.snapshot,
      this.records,
      this.meta.pending,
    );
    this.status = "pending";
    this.persist();
    this.emit();
    this.schedule();
  }
  async sync() {
    if (this.owner === "guest" || this.busy) return;
    const epoch = this.epoch,
      owner = this.owner;
    this.busy = true;
    this.status = "syncing";
    this.error = "";
    this.emit();
    const unchanged = () => this.epoch === epoch && this.owner === owner;
    try {
      const records = [];
      let offset = 0;
      do {
        const page = await this.remote({ action: "pull", offset });
        if (!unchanged()) return;
        records.push(...page.records);
        offset = page.nextOffset;
      } while (offset !== null);
      this.records = records;
      // Pull does not overwrite any unsent local edit.
      for (const r of records)
        if (!this.meta.pending[r.key]) this.meta.revisions[r.key] = r.revision;
      this.snapshot = applyRecords(this.snapshot, records, this.meta.pending);
      this.persist();
      this.emit();
      const sent = Object.values(this.meta.pending).filter(
        (op) => !this.meta.conflicts[op.key],
      );
      for (let i = 0; i < sent.length; i += 20) {
        const batch = sent.slice(i, i + 20),
          result = await this.remote({ action: "push", operations: batch });
        if (!unchanged()) return;
        acknowledge(this.meta, batch, result.results);
        for (const item of result.results) {
          if (item.conflict) {
            if (item.remote) {
              const at = this.records.findIndex((r) => r.key === item.key);
              if (at >= 0) this.records[at] = item.remote;
              else this.records.push(item.remote);
            }
            continue;
          }
          const op = batch.find((o) => o.id === item.id),
            record = {
              ...op,
              revision: item.revision,
              updatedAt: item.updatedAt,
            };
          const at = this.records.findIndex((r) => r.key === item.key);
          if (at >= 0) this.records[at] = record;
          else this.records.push(record);
        }
        this.persist();
        this.emit();
      }
      this.meta.lastSync = Date.now();
      this.status = Object.keys(this.meta.conflicts).length
        ? "conflict"
        : Object.keys(this.meta.pending).length
          ? "pending"
          : "synced";
      this.persist();
    } catch (error) {
      if (unchanged()) {
        this.status = "offline";
        this.error = error.message || "同步失败，记录已保存在本机";
        this.persist();
      }
    } finally {
      this.busy = false;
      if (unchanged()) {
        this.emit();
        if (this.status === "pending") this.schedule();
      } else if (this.owner !== "guest") this.schedule();
    }
  }
}
