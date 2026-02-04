export const dbPrepare = (db: D1Database, sql: string) => db.prepare(sql);

export const dbBind = (stmt: D1PreparedStatement, ...params: unknown[]) =>
  stmt.bind(...params);

export const dbRun = (stmt: D1PreparedStatement) => stmt.run();

export const dbAll = <T = unknown>(stmt: D1PreparedStatement) =>
  stmt.all<T>();
