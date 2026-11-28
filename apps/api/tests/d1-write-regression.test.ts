import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/followup-sequence.ts", import.meta.url), "utf8");
const sql = source.match(/`(UPDATE followup_steps SET due_at=[\s\S]*?)`/)![1];

it("does not rewrite unresolved schedules across 480 daily scheduler phases", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE messages(id TEXT PRIMARY KEY, sent_at TEXT);
      CREATE TABLE followup_steps(root_id TEXT, step INTEGER, child_id TEXT, relative_to TEXT,
        delay_value INTEGER, delay_unit TEXT, due_at INTEGER, queued INTEGER, cancel_reason TEXT);
      CREATE INDEX due ON followup_steps(due_at);
      INSERT INTO messages VALUES('root',NULL);`);
    const insert = db.prepare("INSERT INTO followup_steps VALUES('root',?,?, 'previous',1,'hours',NULL,0,NULL)");
    for(let n=1;n<=50;n++) insert.run(n,'child-'+n);
    const before = db.prepare("SELECT total_changes() n").get()!.n;
    for(let n=0;n<480;n++) expect(db.prepare(sql).run().changes).toBe(0);
    expect(db.prepare("SELECT total_changes() n").get()!.n).toBe(before);
    db.exec("UPDATE messages SET sent_at='2026-11-06T00:00:00Z' WHERE id='root'");
    expect(db.prepare(sql).run().changes).toBe(1);
    expect(db.prepare("SELECT due_at FROM followup_steps WHERE step=1").get()!.due_at)
      .toBe(Date.parse('2026-11-06T01:00:00Z'));
    expect(db.prepare(sql).run().changes).toBe(0);
    db.exec("INSERT INTO messages VALUES('child-1','2026-11-06T02:00:00Z')");
    expect(db.prepare(sql).run().changes).toBe(1);
    expect(db.prepare("SELECT due_at FROM followup_steps WHERE step=2").get()!.due_at)
      .toBe(Date.parse('2026-11-06T03:00:00Z'));
    expect(db.prepare(sql).run().changes).toBe(0);
  } finally { db.close(); }
});

it("preserves existing, cancelled and queued dates and ignores invalid prerequisite timestamps", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE messages(id TEXT PRIMARY KEY, sent_at TEXT);
      CREATE TABLE followup_steps(root_id TEXT, step INTEGER, child_id TEXT, relative_to TEXT,
        delay_value INTEGER, delay_unit TEXT, due_at INTEGER, queued INTEGER, cancel_reason TEXT);
      INSERT INTO messages VALUES('root','2026-11-06T00:00:00Z'),('invalid','bad');
      INSERT INTO followup_steps VALUES
        ('root',1,'a','original',2,'hours',123,0,NULL),
        ('root',2,'b','original',2,'hours',NULL,0,'manual'),
        ('root',3,'c','original',2,'hours',NULL,1,NULL),
        ('invalid',1,'d','original',2,'hours',NULL,0,NULL);`);
    const before = db.prepare('SELECT * FROM followup_steps').all();
    expect(db.prepare(sql).run().changes).toBe(0);
    expect(db.prepare('SELECT * FROM followup_steps').all()).toEqual(before);
  } finally { db.close(); }
});
