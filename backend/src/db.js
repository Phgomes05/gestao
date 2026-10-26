import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tax_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','manager','operator')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, email)
    );
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Geral',
      supplier TEXT NOT NULL DEFAULT '',
      quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      minimum_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
      cost_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
      sale_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, sku)
    );
    CREATE TABLE IF NOT EXISTS movements (
      id BIGSERIAL PRIMARY KEY,
      company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id),
      user_id BIGINT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('entry','exit','adjustment')),
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      reason TEXT NOT NULL,
      balance_after NUMERIC(14,3) NOT NULL CHECK (balance_after >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id, active);
    CREATE INDEX IF NOT EXISTS idx_movements_company_date ON movements(company_id, created_at DESC);
  `);
}
