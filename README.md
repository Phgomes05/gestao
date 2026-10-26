# StockWise Enterprise — protótipo full-stack inicial

O projeto inclui a interface React existente e uma API em Node.js/Express com PostgreSQL. A API implementa cadastro de empresa/administrador, login, produtos, movimentações transacionais, métricas do dashboard e exportação CSV. A interface original ainda funciona em modo de demonstração e **não está conectada automaticamente à API** nesta entrega.

## Requisitos
- Node.js 20+
- PostgreSQL 16+ (nativo no Windows ou via Docker Desktop)
- VS Code (opcional)

## 1. Iniciar o banco de dados no Windows

O caminho recomendado no Windows é instalar o PostgreSQL nativo. No PowerShell como administrador:

```powershell
winget install --id PostgreSQL.PostgreSQL.16 --exact
```

Durante a instalação, defina uma senha para o usuário `postgres` e mantenha a porta `5432`. No pgAdmin, conecte ao servidor local usando a senha escolhida, abra o Query Tool conectado ao banco `postgres` e execute:

```sql
CREATE ROLE stockwise LOGIN PASSWORD 'stockwise_dev_password';
```

Em seguida, execute separadamente:

```sql
CREATE DATABASE stockwise OWNER stockwise;
```

Se o usuário ou banco já existir, atualize a senha do usuário para corresponder a `backend/.env` e não crie novamente o banco. Não compartilhe a senha do usuário `postgres`.

### Alternativa: Docker Desktop

Com Docker Desktop e o WSL instalados e iniciados, na raiz `stockwise` execute:

```powershell
docker compose up -d database
```

## 2. Configurar a API
No PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
npm.cmd install
```

Abra `backend/.env` e troque `JWT_SECRET` por uma string aleatória longa (pelo menos 32 caracteres). Para PostgreSQL nativo, a URL de banco padrão já está configurada para `localhost:5432`.

Inicie a API:

```powershell
npm.cmd run dev
```

Teste no navegador: `http://localhost:3001/api/health`. Deve retornar `status: "ok"` e `database: "connected"`.

## 3. Iniciar a interface existente
Abra um segundo terminal na raiz `stockwise`:

```powershell
npm.cmd install
npm.cmd run dev
```

Abra o endereço exibido pelo Vite, normalmente `http://localhost:5173`.

## Endpoints iniciais
- `GET /api/health` — verificação de API e banco
- `POST /api/auth/register` — cria empresa e administrador; JSON: `companyName`, `name`, `email`, `password`
- `POST /api/auth/login` — JSON: `companyName`, `email`, `password`
- `GET /api/me` — usuário autenticado
- `GET/POST /api/products` — listar/cadastrar produtos
- `PATCH/DELETE /api/products/:id` — editar/arquivar produto
- `POST/GET /api/movements` — registrar/listar movimentações
- `GET /api/dashboard` — indicadores reais do banco
- `GET /api/reports/stock.csv` — relatório CSV do estoque

Para endpoints protegidos, envie o cabeçalho `Authorization: Bearer <token>`.

### Exemplo de cadastro de empresa
```json
{
  "companyName": "Empresa Demonstração",
  "name": "Admin StockWise",
  "email": "admin@exemplo.com",
  "password": "uma-senha-forte-com-10-ou-mais"
}
```

### Exemplo de movimentação
```json
{
  "productId": 1,
  "type": "entry",
  "quantity": 10,
  "reason": "Reposição de compra"
}
```

Tipos de movimentação: `entry` (entrada), `exit` (saída) e `adjustment` (ajuste para o saldo informado).

## Segurança e limites desta versão
- As consultas e alterações de produtos/movimentações são limitadas ao `companyId` do token.
- Senhas são armazenadas como hash bcrypt; tokens expiram em 8 horas.
- Movimentações bloqueiam a linha do produto durante a operação e impedem saldo negativo.
- Exclusão de produto é lógica (arquivamento), preservando histórico.
- Não coloque segredos no frontend nem publique com a senha de banco de desenvolvimento.
- Ainda faltam: conectar todas as telas React à API, gestão de usuários/convites e permissões completas, testes automatizados, limitação de tentativas de login, recuperação de senha, backups monitorados, observabilidade, integração real de IA, revisão de segurança e implantação com HTTPS.
- Esta entrega é uma base executável para desenvolvimento e demonstração técnica, **não é ainda um sistema certificado ou pronto para produção empresarial**. Teste e revisão profissional são necessários antes de usar com dados reais.
