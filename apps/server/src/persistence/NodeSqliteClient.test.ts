import { DatabaseSync } from "node:sqlite";

import { assert, it } from "@effect/vitest";
import { Duration, Effect, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it as test, vi } from "vitest";

import * as SqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(SqliteClient.layerMemory());

describe("sqlite statement classification", () => {
  test("treats schema and write statements as non-row producing", () => {
    expect(SqliteClient.sqliteStatementHasResultRows("ALTER TABLE t ADD COLUMN x TEXT")).toBe(
      false,
    );
    expect(SqliteClient.sqliteStatementHasResultRows("CREATE TABLE t(id INTEGER)")).toBe(false);
    expect(SqliteClient.sqliteStatementHasResultRows("INSERT INTO t(id) VALUES (1)")).toBe(false);
    expect(SqliteClient.sqliteStatementHasResultRows("BEGIN EXCLUSIVE")).toBe(false);
    expect(SqliteClient.sqliteStatementChangesSchema("ALTER TABLE t ADD COLUMN x TEXT")).toBe(true);
    expect(SqliteClient.sqliteStatementChangesSchema("INSERT INTO t(id) VALUES (1)")).toBe(false);
  });

  test("treats reads and pragmas as row producing", () => {
    expect(SqliteClient.sqliteStatementHasResultRows("SELECT id FROM t")).toBe(true);
    expect(SqliteClient.sqliteStatementHasResultRows("PRAGMA journal_mode = WAL")).toBe(true);
    expect(
      SqliteClient.sqliteStatementHasResultRows("INSERT INTO t(id) VALUES (1) RETURNING id"),
    ).toBe(true);
    expect(
      SqliteClient.sqliteStatementHasResultRows("/* comment */ CREATE TABLE t(id INTEGER)"),
    ).toBe(false);
  });
});

layer("NodeSqliteClient", (it) => {
  it.effect("runs prepared queries and returns positional values", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`INSERT INTO entries(name) VALUES (${"alpha"}), (${"beta"})`;

      const rows = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM entries ORDER BY id
    `;
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.name, "alpha");
      assert.equal(rows[1]?.name, "beta");

      const values = yield* sql`SELECT id, name FROM entries ORDER BY id`.values;
      assert.equal(values.length, 2);
      assert.equal(values[0]?.[1], "alpha");
      assert.equal(values[1]?.[1], "beta");
    }),
  );

  it.effect("runs pragma inspection and ALTER inside one write transaction", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE projection_probe(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          const columns = yield* sql<{ readonly name: string }>`
            SELECT name
            FROM pragma_table_info('projection_probe')
            WHERE name = 'sidechat_source_thread_id'
          `;
          assert.equal(columns.length, 0);
          yield* sql`
            ALTER TABLE projection_probe
            ADD COLUMN sidechat_source_thread_id TEXT
          `;
        }),
      );

      const added = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_table_info('projection_probe')
        WHERE name = 'sidechat_source_thread_id'
      `;
      assert.equal(added.length, 1);
    }),
  );

  it.effect("does not park on the connection semaphore when TransactionConnection is dropped", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE txn_probe(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          const withoutReservedConnection = <A, E, R>(
            effect: Effect.Effect<A, E, R>,
          ): Effect.Effect<A, E, R> =>
            effect.pipe(
              Effect.updateServices((services) =>
                ServiceMap.omit(SqlClient.TransactionConnection)(services),
              ),
            );

          yield* withoutReservedConnection(sql`INSERT INTO txn_probe(name) VALUES (${"held"})`);
          const columns = yield* withoutReservedConnection(
            sql<{ readonly name: string }>`
              SELECT name FROM pragma_table_info('txn_probe') WHERE name = 'id'
            `,
          );
          assert.equal(columns.length, 1);
          yield* withoutReservedConnection(sql`ALTER TABLE txn_probe ADD COLUMN extra TEXT`);
        }),
      );

      const rows = yield* sql<{ readonly name: string }>`SELECT name FROM txn_probe`;
      assert.deepStrictEqual(rows, [{ name: "held" }]);
    }).pipe(Effect.timeout(Duration.seconds(2))),
  );
});

test("does not inspect StatementSync.columns for schema-changing SQL", async () => {
  const probe = new DatabaseSync(":memory:");
  const proto = Object.getPrototypeOf(probe.prepare("SELECT 1"));
  const columns = vi.spyOn(proto, "columns");
  probe.close();

  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE storm(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      for (let index = 0; index < 24; index += 1) {
        yield* sql.unsafe(`ALTER TABLE storm ADD COLUMN extra_${index} TEXT`);
      }
      yield* sql`INSERT INTO storm(name) VALUES (${"alpha"})`;
      const rows = yield* sql<{ readonly name: string }>`SELECT name FROM storm`;
      expect(rows).toEqual([{ name: "alpha" }]);
    }).pipe(Effect.provide(SqliteClient.layerMemory())),
  );

  expect(columns).not.toHaveBeenCalled();
});
