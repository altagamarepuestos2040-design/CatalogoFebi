-- Ejecutar en Supabase > SQL Editor

CREATE TABLE IF NOT EXISTS pedidos (
  id               BIGSERIAL PRIMARY KEY,
  cliente_nombre   TEXT NOT NULL,
  cliente_empresa  TEXT,
  cliente_tel      TEXT NOT NULL,
  cliente_dir      TEXT,
  metodo_pago      TEXT DEFAULT 'transferencia',
  notas            TEXT,
  descuento_pct    INT DEFAULT 0,
  subtotal         NUMERIC DEFAULT 0,
  total            NUMERIC DEFAULT 0,
  items            TEXT,  -- JSON string de los productos
  estado           TEXT DEFAULT 'pendiente',  -- pendiente | confirmado | enviado | cancelado
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Permitir inserts anónimos (desde el catálogo sin login)
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insert_public" ON pedidos FOR INSERT WITH CHECK (true);
CREATE POLICY "select_admin" ON pedidos FOR SELECT USING (true);
CREATE POLICY "update_admin" ON pedidos FOR UPDATE USING (true);
