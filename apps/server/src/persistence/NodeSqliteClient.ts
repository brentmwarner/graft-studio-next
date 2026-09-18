/**
 * Port of `@effect/sql-sqlite-node` that uses the native `node:sqlite`
 * bindings instead of `better-sqlite3`.
 *
 * @module SqliteClient
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";

import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as ServiceMap from "effect/ServiceMap";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

import { tracePackagedStartup } from "../packagedStartupTrace.ts";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

const describeSql = (sql: string): string => sql.replaceAll(/\s+/gu, " ").trim().slice(0, 160);
const traceSqliteStatements =
  process.env.GRAFT_DESKTOP_PACKAGED === "1" && process.env.GRAFT_TRACE_SQLITE_STARTUP === "1";

const traceSqliteStatement = (event: string, sql: string): void => {
  if (!traceSqliteStatements) return;
  tracePackagedStartup(`node sqlite ${event} sql=${describeSql(sql)}`);
};

const LEADING_SQL_NOISE = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/u;
const RESULT_ROW_KEYWORDS = new Set(["select", "values", "explain", "pragma", "with"]);
const NON_RESULT_ROW_KEYWORDS = new Set([
  "alter",
  "create",
  "drop",
  "insert",
  "update",
  "delete",
  "replace",
  "begin",
  "commit",
  "end",
  "rollback",
  "savepoint",
  "release",
  "vacuum",
  "reindex",
  "analyze",
  "attach",
  "detach",
]);

export function sqliteLeadingKeyword(sql: string): string {
  return (
    sql
      .replace(LEADING_SQL_NOISE, "")
      .match(/^([A-Za-z]+)/u)?.[1]
      ?.toLowerCase() ?? ""
  );
}

/**
 * Classifies whether a statement produces a result set without calling
 * `StatementSync.columns()`. That native inspection can block inside a long
 * exclusive WAL transaction after repeated schema changes — the packaged Intel
 * macOS startup path that applies every fresh-schema migration in one Effect
 * Migrator transaction.
 *
 * `null` means the SQL shape is unknown and callers may fall back to `columns()`.
 */
export function sqliteStatementHasResultRows(sql: string): boolean | null {
  const keyword = sqliteLeadingKeyword(sql);
  if (RESULT_ROW_KEYWORDS.has(keyword) || /\breturning\b/iu.test(sql)) {
    return true;
  }
  if (NON_RESULT_ROW_KEYWORDS.has(keyword)) {
    return false;
  }
  return null;
}

export function sqliteStatementChangesSchema(sql: string): boolean {
  const keyword = sqliteLeadingKeyword(sql);
  return keyword === "alter" || keyword === "create" || keyword === "drop";
}

export const TypeId: TypeId = "~local/sqlite-node/SqliteClient";

export type TypeId = "~local/sqlite-node/SqliteClient";

/**
 * SqliteClient - Effect service tag for the sqlite SQL client.
 */
export const SqliteClient = ServiceMap.Service<Client.SqlClient>(
  "graft/persistence/NodeSqliteClient",
);

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly allowExtension?: boolean | undefined;
  readonly prepareCacheSize?: number | undefined;
  readonly prepareCacheTTL?: Duration.Input | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

export interface SqliteMemoryClientConfig extends Omit<
  SqliteClientConfig,
  "filename" | "readonly"
> {}

/**
 * Verify that the current Node.js version includes the `node:sqlite` APIs
 * used by `NodeSqliteClient` — specifically `StatementSync.columns()` (added
 * in Node 22.16.0 / 23.11.0).
 *
 * @see https://github.com/nodejs/node/pull/57490
 */
const checkNodeSqliteCompat = () => {
  const parts = process.versions.node.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const supported = (major === 22 && minor >= 16) || (major === 23 && minor >= 11) || major >= 24;

  if (!supported) {
    return Effect.die(
      `Node.js ${process.versions.node} is missing required node:sqlite APIs ` +
        `(StatementSync.columns). Upgrade to Node.js >=22.16, >=23.11, or >=24.`,
    );
  }
  return Effect.void;
};

const makeWithDatabase = (
  options: SqliteClientConfig,
  openDatabase: () => DatabaseSync,
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    tracePackagedStartup("node sqlite client construction started");
    yield* checkNodeSqliteCompat();

    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const makeConnection = Effect.gen(function* () {
      const scope = yield* Effect.scope;
      tracePackagedStartup("node sqlite database open started");
      const db = openDatabase();
      tracePackagedStartup("node sqlite database open completed");
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => db.close()),
      );

      const statementReaderCache = new WeakMap<StatementSync, boolean>();
      const statementSql = new WeakMap<StatementSync, string>();
      const inspectColumns = (statement: StatementSync): boolean => {
        const cached = statementReaderCache.get(statement);
        if (cached !== undefined) {
          return cached;
        }
        if (traceSqliteStatements) {
          traceSqliteStatement(
            "columns inspection started",
            statementSql.get(statement) ?? "<unknown>",
          );
        }
        const value = statement.columns().length > 0;
        if (traceSqliteStatements) {
          traceSqliteStatement(
            "columns inspection completed",
            statementSql.get(statement) ?? "<unknown>",
          );
        }
        statementReaderCache.set(statement, value);
        return value;
      };
      const statementHasRows = (sql: string, statement: StatementSync): boolean => {
        const classified = sqliteStatementHasResultRows(sql);
        return classified === null ? inspectColumns(statement) : classified;
      };

      const prepareCache = new Map<string, StatementSync>();
      const prepareCacheCapacity = options.prepareCacheSize ?? 200;
      const invalidatePrepareCache = () => {
        if (prepareCache.size === 0) return;
        if (traceSqliteStatements) {
          tracePackagedStartup(`node sqlite prepare cache invalidated size=${prepareCache.size}`);
        }
        prepareCache.clear();
      };
      const prepareStatement = (sql: string): StatementSync => {
        const cached = prepareCache.get(sql);
        if (cached) return cached;
        traceSqliteStatement("prepare started", sql);
        const statement = db.prepare(sql);
        if (traceSqliteStatements) statementSql.set(statement, sql);
        if (prepareCache.size >= prepareCacheCapacity) {
          const oldest = prepareCache.keys().next().value;
          if (oldest !== undefined) prepareCache.delete(oldest);
        }
        prepareCache.set(sql, statement);
        traceSqliteStatement("prepare completed", sql);
        return statement;
      };
      const executeUnparameterizedNonQuery = (sql: string): ReadonlyArray<any> => {
        traceSqliteStatement("exec started", sql);
        db.exec(sql);
        if (sqliteStatementChangesSchema(sql)) {
          invalidatePrepareCache();
        }
        traceSqliteStatement("exec completed", sql);
        return [];
      };
      tracePackagedStartup("node sqlite statement cache ready");

      const runPreparedStatement = (sql: string, params: ReadonlyArray<unknown>, raw: boolean) =>
        Effect.withFiber<ReadonlyArray<any>, SqlError>((fiber) => {
          try {
            const statement = prepareStatement(sql);
            statement.setReadBigInts(Boolean(ServiceMap.get(fiber.services, Client.SafeIntegers)));
            if (statementHasRows(sql, statement)) {
              return Effect.succeed(statement.all(...(params as any)));
            }
            const result = statement.run(...(params as any));
            if (sqliteStatementChangesSchema(sql)) {
              invalidatePrepareCache();
            }
            return Effect.succeed(raw ? (result as unknown as ReadonlyArray<any>) : []);
          } catch (cause) {
            return Effect.fail(new SqlError({ cause, message: "Failed to execute statement" }));
          }
        });

      const run = (sql: string, params: ReadonlyArray<unknown>, raw = false) => {
        if (params.length === 0 && sqliteStatementHasResultRows(sql) === false) {
          return Effect.try({
            try: () => executeUnparameterizedNonQuery(sql),
            catch: (cause) => new SqlError({ cause, message: "Failed to execute statement" }),
          });
        }
        if (!traceSqliteStatements) {
          return runPreparedStatement(sql, params, raw);
        }
        return Effect.gen(function* () {
          traceSqliteStatement("statement acquisition started", sql);
          traceSqliteStatement("statement execution started", sql);
          const rows = yield* runPreparedStatement(sql, params, raw);
          traceSqliteStatement("statement execution completed", sql);
          return rows;
        });
      };

      const runValues = (sql: string, params: ReadonlyArray<unknown>) => {
        if (params.length === 0 && sqliteStatementHasResultRows(sql) === false) {
          return Effect.try({
            try: () => {
              executeUnparameterizedNonQuery(sql);
              return [] as ReadonlyArray<ReadonlyArray<unknown>>;
            },
            catch: (cause) => new SqlError({ cause, message: "Failed to execute statement" }),
          });
        }
        const effect = Effect.try({
          try: () => {
            const statement = prepareStatement(sql);
            if (statementHasRows(sql, statement)) {
              statement.setReturnArrays(true);
              try {
                return statement.all(...(params as any)) as unknown as ReadonlyArray<
                  ReadonlyArray<unknown>
                >;
              } finally {
                statement.setReturnArrays(false);
              }
            }
            statement.run(...(params as any));
            if (sqliteStatementChangesSchema(sql)) {
              invalidatePrepareCache();
            }
            return [];
          },
          catch: (cause) => new SqlError({ cause, message: "Failed to execute statement" }),
        });
        if (!traceSqliteStatements) return effect;
        return Effect.sync(() => traceSqliteStatement("values execution started", sql)).pipe(
          Effect.andThen(effect),
          Effect.tap(() =>
            Effect.sync(() => traceSqliteStatement("values execution completed", sql)),
          ),
        );
      };

      return identity<Connection>({
        execute(sql, params, rowTransform) {
          return rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params);
        },
        executeRaw(sql, params) {
          return run(sql, params, true);
        },
        executeValues(sql, params) {
          return runValues(sql, params);
        },
        executeUnprepared(sql, params, rowTransform) {
          const effect = run(sql, params ?? []);
          return rowTransform ? Effect.map(effect, rowTransform) : effect;
        },
        executeStream(_sql, _params) {
          return Stream.die("executeStream not implemented");
        },
      });
    });

    const semaphore = yield* Semaphore.make(1);
    const connection = yield* makeConnection;
    tracePackagedStartup("node sqlite connection ready");

    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection));
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!;
      const scope = ServiceMap.getUnsafe(fiber.services, Scope.Scope);
      if (!traceSqliteStatements) {
        return Effect.as(
          Effect.tap(restore(semaphore.take(1)), () =>
            Scope.addFinalizer(scope, semaphore.release(1)),
          ),
          connection,
        );
      }
      return Effect.as(
        Effect.sync(() => {
          if (traceSqliteStatements) {
            tracePackagedStartup("node sqlite transaction permit requested");
          }
        }).pipe(
          Effect.andThen(restore(semaphore.take(1))),
          Effect.tap(() =>
            Effect.sync(() => {
              if (traceSqliteStatements) {
                tracePackagedStartup("node sqlite transaction permit acquired");
              }
            }).pipe(Effect.andThen(Scope.addFinalizer(scope, semaphore.release(1)))),
          ),
        ),
        connection,
      );
    });

    const client = yield* Client.make({
      acquirer,
      compiler,
      transactionAcquirer,
      spanAttributes: [
        ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
        [ATTR_DB_SYSTEM_NAME, "sqlite"],
      ],
      transformRows,
    });
    tracePackagedStartup("node sqlite client construction completed");
    return client;
  });

const make = (
  options: SqliteClientConfig,
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
  makeWithDatabase(
    options,
    () =>
      new DatabaseSync(options.filename, {
        readOnly: options.readonly ?? false,
        allowExtension: options.allowExtension ?? false,
      }),
  );

const makeMemory = (
  config: SqliteMemoryClientConfig = {},
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
  makeWithDatabase(
    {
      ...config,
      filename: ":memory:",
      readonly: false,
    },
    () => {
      const database = new DatabaseSync(":memory:", {
        allowExtension: config.allowExtension ?? false,
      });
      return database;
    },
  );

export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<Client.SqlClient, Config.ConfigError> =>
  Layer.effectServices(
    Config.unwrap(config)
      .asEffect()
      .pipe(
        Effect.flatMap(make),
        Effect.map((client) =>
          ServiceMap.make(SqliteClient, client).pipe(ServiceMap.add(Client.SqlClient, client)),
        ),
      ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layer = (config: SqliteClientConfig): Layer.Layer<Client.SqlClient> =>
  Layer.effectServices(
    Effect.map(make(config), (client) =>
      ServiceMap.make(SqliteClient, client).pipe(ServiceMap.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layerMemory = (config: SqliteMemoryClientConfig = {}): Layer.Layer<Client.SqlClient> =>
  Layer.effectServices(
    Effect.map(makeMemory(config), (client) =>
      ServiceMap.make(SqliteClient, client).pipe(ServiceMap.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
