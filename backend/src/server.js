import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { z } from 'zod';
import { pool, initDb } from './db.js';

dotenv.config();
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('ATENÇÃO: configure JWT_SECRET com pelo menos 32 caracteres no arquivo .env antes de usar.');
}
const signToken = (user) => jwt.sign(
  { sub: String(user.id), companyId: String(user.company_id), role: user.role, email: user.email },
  JWT_SECRET || 'development-only-change-me-please-123456789',
  { expiresIn: '8h' }
);

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET || 'development-only-change-me-please-123456789');
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', service: 'StockWise API', database: 'connected' });
}));

const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).transform(v => v.toLowerCase()),
  password: z.string().min(10).max(128)
});
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = (await client.query(
      'INSERT INTO companies(name) VALUES($1) RETURNING id, name', [input.companyName]
    )).rows[0];
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = (await client.query(
      `INSERT INTO users(company_id,name,email,password_hash,role)
       VALUES($1,$2,$3,$4,'admin') RETURNING id,company_id,name,email,role`,
      [company.id, input.name, input.email, passwordHash]
    )).rows[0];
    await client.query('COMMIT');
    res.status(201).json({ token: signToken(user), user, company });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe uma conta com esse e-mail nesta empresa.' });
    throw e;
  } finally { client.release(); }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const schema = z.object({ email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(1), companyName: z.string().trim().min(2) });
  const input = schema.parse(req.body);
  const result = await pool.query(
    `SELECT u.id,u.company_id,u.name,u.email,u.password_hash,u.role,c.name AS company_name
     FROM users u JOIN companies c ON c.id=u.company_id
     WHERE lower(u.email)=lower($1) AND lower(c.name)=lower($2)`,
    [input.email, input.companyName]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
    return res.status(401).json({ error: 'E-mail, senha ou empresa inválidos.' });
  }
  res.json({ token: signToken(user), user: { id:user.id, company_id:user.company_id, name:user.name, email:user.email, role:user.role }, company: { id:user.company_id, name:user.company_name } });
}));

app.get('/api/me', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id, company_id, name, email, role FROM users WHERE id=$1 AND company_id=$2',
    [req.user.sub, req.user.companyId]
  );
  if (!result.rowCount) return res.status(401).json({ error: 'Usuário não encontrado.' });
  res.json({ user: result.rows[0] });
}));

const productSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(180),
  category: z.string().trim().max(120).default('Geral'),
  supplier: z.string().trim().max(180).default(''),
  quantity: z.coerce.number().min(0).default(0),
  minimumQuantity: z.coerce.number().min(0).default(0),
  costPrice: z.coerce.number().min(0).default(0),
  salePrice: z.coerce.number().min(0).default(0)
});
app.get('/api/products', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id,sku,name,category,supplier,quantity,minimum_quantity AS "minimumQuantity",
      cost_price AS "costPrice",sale_price AS "salePrice",active,created_at AS "createdAt"
     FROM products WHERE company_id=$1 AND active=TRUE ORDER BY name`,
    [req.user.companyId]
  );
  res.json({ items: result.rows });
}));
app.post('/api/products', auth, asyncRoute(async (req, res) => {
  const p = productSchema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO products(company_id,sku,name,category,supplier,quantity,minimum_quantity,cost_price,sale_price)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,sku,name,category,supplier,quantity,minimum_quantity AS "minimumQuantity",
       cost_price AS "costPrice",sale_price AS "salePrice",active`,
      [req.user.companyId,p.sku,p.name,p.category,p.supplier,p.quantity,p.minimumQuantity,p.costPrice,p.salePrice]
    );
    const product = result.rows[0];
    if (Number(p.quantity) > 0) {
      await client.query(
        `INSERT INTO movements(company_id,product_id,user_id,type,quantity,reason,balance_after)
         VALUES($1,$2,$3,'entry',$4,'Saldo inicial',$4)`,
        [req.user.companyId, product.id, req.user.sub, p.quantity]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ item: product });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Este SKU já está cadastrado na empresa.' });
    throw e;
  } finally { client.release(); }
}));
app.patch('/api/products/:id', auth, asyncRoute(async (req, res) => {
  const schema = productSchema.partial();
  const p = schema.parse(req.body);
  const fields = {
    sku: 'sku', name: 'name', category: 'category', supplier: 'supplier',
    quantity: 'quantity', minimumQuantity: 'minimum_quantity',
    costPrice: 'cost_price', salePrice: 'sale_price'
  };
  const keys = Object.keys(p).filter(k => fields[k]);
  if (!keys.length) return res.status(400).json({ error: 'Nenhum campo válido informado.' });
  const values = [req.user.companyId, req.params.id];
  const setters = keys.map((k, i) => { values.push(p[k]); return `${fields[k]}=$${i+3}`; });
  setters.push('updated_at=NOW()');
  const result = await pool.query(
    `UPDATE products SET ${setters.join(', ')} WHERE company_id=$1 AND id=$2 AND active=TRUE
     RETURNING id,sku,name,category,supplier,quantity,minimum_quantity AS "minimumQuantity",
     cost_price AS "costPrice",sale_price AS "salePrice",active`, values
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json({ item: result.rows[0], note: 'Edição direta de saldo não gera movimentação; use /api/movements para rastreabilidade.' });
}));
app.delete('/api/products/:id', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'UPDATE products SET active=FALSE,updated_at=NOW() WHERE company_id=$1 AND id=$2 AND active=TRUE RETURNING id',
    [req.user.companyId, req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.status(204).end();
}));

const movementSchema = z.object({
  productId: z.coerce.number().int().positive(),
  type: z.enum(['entry','exit','adjustment']),
  quantity: z.coerce.number().positive(),
  reason: z.string().trim().min(2).max(500)
});
app.post('/api/movements', auth, asyncRoute(async (req, res) => {
  const m = movementSchema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT id,quantity FROM products WHERE id=$1 AND company_id=$2 AND active=TRUE FOR UPDATE',
      [m.productId, req.user.companyId]
    );
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produto não encontrado nesta empresa.' });
    }
    const before = Number(found.rows[0].quantity);
    let after = before;
    if (m.type === 'entry') after += m.quantity;
    if (m.type === 'exit') after -= m.quantity;
    if (m.type === 'adjustment') after = m.quantity;
    if (after < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Saldo insuficiente para esta saída.' });
    }
    await client.query('UPDATE products SET quantity=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3',
      [after,m.productId,req.user.companyId]);
    const saved = await client.query(
      `INSERT INTO movements(company_id,product_id,user_id,type,quantity,reason,balance_after)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,product_id AS "productId",type,quantity,reason,balance_after AS "balanceAfter",created_at AS "createdAt"`,
      [req.user.companyId,m.productId,req.user.sub,m.type,m.quantity,m.reason,after]
    );
    await client.query('COMMIT');
    res.status(201).json({ item: saved.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}));
app.get('/api/movements', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT m.id,m.product_id AS "productId",p.name AS "productName",p.sku,
      u.name AS "userName",m.type,m.quantity,m.reason,m.balance_after AS "balanceAfter",
      m.created_at AS "createdAt"
     FROM movements m JOIN products p ON p.id=m.product_id
     JOIN users u ON u.id=m.user_id
     WHERE m.company_id=$1 ORDER BY m.created_at DESC LIMIT 1000`,
    [req.user.companyId]
  );
  res.json({ items: result.rows });
}));
app.get('/api/dashboard', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE active) AS "productCount",
      COALESCE(SUM(quantity) FILTER (WHERE active),0) AS "unitsInStock",
      COALESCE(SUM(quantity*cost_price) FILTER (WHERE active),0) AS "stockValue",
      COUNT(*) FILTER (WHERE active AND quantity=0) AS "outOfStock",
      COUNT(*) FILTER (WHERE active AND quantity>0 AND quantity<=minimum_quantity) AS "lowStock"
     FROM products WHERE company_id=$1`,
    [req.user.companyId]
  );
  res.json({ metrics: result.rows[0] });
}));

app.get('/api/reports/stock.csv', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT sku,name,category,quantity,minimum_quantity,cost_price,quantity*cost_price AS stock_value
     FROM products WHERE company_id=$1 AND active=TRUE ORDER BY name`,
    [req.user.companyId]
  );
  const escape = v => `"${String(v ?? '').replaceAll('"','""')}"`;
  const rows = [['SKU','Produto','Categoria','Quantidade','Estoque mínimo','Custo unitário','Valor em estoque'],
    ...result.rows.map(p => [p.sku,p.name,p.category,p.quantity,p.minimum_quantity,p.cost_price,p.stock_value])];
  const csv = '\uFEFF' + rows.map(r => r.map(escape).join(';')).join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="stockwise-estoque.csv"');
  res.send(csv);
}));

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos.', details: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
  if (err.code === '23505') return res.status(409).json({ error: 'Registro duplicado.' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Consulte os logs da API.' });
});

const port = Number(process.env.PORT || 3001);
await initDb();
app.listen(port, () => console.log(`StockWise API em http://localhost:${port}`));
