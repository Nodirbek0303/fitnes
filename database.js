"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createDatabase(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL || "";
  let sqlite;
  let pool;

  if (connectionString) {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString,
      max: process.env.VERCEL ? 1 : 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    });
  } else {
    if (process.env.VERCEL) throw new Error("Vercel uchun DATABASE_URL (PostgreSQL) sozlanishi kerak");
    const dbPath = options.dbPath || process.env.DATABASE_PATH ||
      path.join(__dirname, "data", "gym.sqlite3");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    sqlite = new DatabaseSync(dbPath);
    sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  function adapter(query) {
    return {
      exec: async (statement) => query(statement),
      prepare(statement) {
        return {
          async get(...parameters) {
            if (sqlite) return sqlite.prepare(statement).get(...parameters);
            const result = await query(statement, parameters);
            return result.rows[0];
          },
          async all(...parameters) {
            if (sqlite) return sqlite.prepare(statement).all(...parameters);
            const result = await query(statement, parameters);
            return result.rows;
          },
          async run(...parameters) {
            if (sqlite) return sqlite.prepare(statement).run(...parameters);
            const result = await query(statement, parameters);
            return { changes: result.rowCount };
          },
        };
      },
    };
  }

  const database = {};

  database.prepare = (statement) => {
    let queryCount = 0;
    const queryStatement = connectionString
      ? statement.replace(/\?/g, () => "$" + (++queryCount))
      : statement;
    return {
      async get(...parameters) {
        if (sqlite) return sqlite.prepare(statement).get(...parameters);
        const result = await pool.query(queryStatement, parameters);
        return result.rows[0];
      },
      async all(...parameters) {
        if (sqlite) return sqlite.prepare(statement).all(...parameters);
        const result = await pool.query(queryStatement, parameters);
        return result.rows;
      },
      async run(...parameters) {
        if (sqlite) return sqlite.prepare(statement).run(...parameters);
        const result = await pool.query(queryStatement, parameters);
        return { changes: result.rowCount };
      },
    };
  };
  database.exec = async (statement) => {
    if (sqlite) return sqlite.exec(statement);
    return pool.query(statement);
  };
  database.transaction = async (operation) => {
    if (sqlite) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await operation(adapter((statement) => sqlite.exec(statement)));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(adapter((statement, parameters) => {
        let index = 0;
        const converted = statement.replace(/\?/g, () => "$" + (++index));
        return client.query(converted, parameters);
      }));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  database.close = () => sqlite ? sqlite.close() : pool.end();
  database.isPostgres = !!connectionString;

  return database;
}

module.exports = { createDatabase };
