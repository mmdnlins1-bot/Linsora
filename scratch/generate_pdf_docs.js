const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

async function generatePDF() {
  console.log('Iniciando geração da documentação em PDF...');

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>LINSORA Finances — Documentação Técnica do Sistema</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 15mm 20mm 15mm;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background-color: #ffffff;
      line-height: 1.6;
      font-size: 11pt;
      margin: 0;
      padding: 0;
    }

    /* CAPA */
    .cover-page {
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100vh;
      box-sizing: border-box;
      padding: 40px 20px;
      background: linear-gradient(135deg, #064e3b 0%, #047857 50%, #059669 100%);
      color: #ffffff;
      border-radius: 12px;
    }

    .cover-header {
      border-bottom: 2px solid rgba(255, 255, 255, 0.2);
      padding-bottom: 20px;
    }

    .cover-logo {
      font-size: 32pt;
      font-weight: 800;
      letter-spacing: -1px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .cover-subtitle {
      font-size: 14pt;
      font-weight: 300;
      opacity: 0.9;
      margin-top: 5px;
    }

    .cover-main {
      margin-top: 80px;
    }

    .cover-title {
      font-size: 28pt;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 15px;
      color: #ffffff;
    }

    .cover-description {
      font-size: 12pt;
      max-width: 600px;
      opacity: 0.95;
      line-height: 1.7;
      background: rgba(255, 255, 255, 0.1);
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #34d399;
    }

    .cover-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.2);
      padding-top: 20px;
      font-size: 9.5pt;
      opacity: 0.85;
      display: flex;
      justify-content: space-between;
    }

    /* CONTEÚDO DA DOCUMENTAÇÃO */
    .page {
      page-break-after: always;
    }
    
    .page:last-child {
      page-break-after: avoid;
    }

    h1, h2, h3, h4 {
      color: #0f172a;
      font-weight: 700;
      margin-top: 24px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }

    h1 {
      font-size: 20pt;
      border-bottom: 2px solid #10b981;
      padding-bottom: 8px;
      color: #065f46;
      margin-top: 0;
    }

    h2 {
      font-size: 15pt;
      color: #047857;
      border-left: 4px solid #10b981;
      padding-left: 10px;
      margin-top: 28px;
    }

    h3 {
      font-size: 12pt;
      color: #1e293b;
    }

    p {
      margin-bottom: 12px;
      text-align: justify;
    }

    ul, ol {
      margin-top: 6px;
      margin-bottom: 14px;
      padding-left: 24px;
    }

    li {
      margin-bottom: 4px;
    }

    /* TABELAS */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 9.5pt;
      page-break-inside: avoid;
    }

    th, td {
      border: 1px solid #cbd5e1;
      padding: 8px 12px;
      text-align: left;
    }

    th {
      background-color: #0f172a;
      color: #ffffff;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 8.5pt;
      letter-spacing: 0.5px;
    }

    tr:nth-child(even) {
      background-color: #f8fafc;
    }

    /* CAIXAS DE DESTAQUE & CARDS */
    .info-card {
      background-color: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 5px solid #10b981;
      padding: 14px 18px;
      border-radius: 6px;
      margin: 16px 0;
      page-break-inside: avoid;
    }

    .tech-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 16px 0;
      page-break-inside: avoid;
    }

    .tech-item {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px;
    }

    .tech-item strong {
      color: #047857;
      display: block;
      font-size: 10.5pt;
      margin-bottom: 4px;
    }

    /* DIAGRAMAS E FLUXOS */
    .diagram-container {
      background: #0f172a;
      color: #f8fafc;
      padding: 18px;
      border-radius: 8px;
      margin: 18px 0;
      font-family: "Courier New", Courier, monospace;
      font-size: 9pt;
      line-height: 1.4;
      page-break-inside: avoid;
      overflow-x: auto;
    }

    .diagram-title {
      color: #34d399;
      font-weight: bold;
      margin-bottom: 10px;
      font-family: sans-serif;
      font-size: 10pt;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    code {
      font-family: Consolas, Monaco, "Andale Mono", monospace;
      background-color: #e2e8f0;
      color: #0f172a;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9pt;
    }

    pre code {
      background-color: transparent;
      padding: 0;
      color: #f8fafc;
    }

    .code-block {
      background-color: #0f172a;
      color: #f8fafc;
      padding: 14px;
      border-radius: 6px;
      font-size: 8.5pt;
      overflow-x: auto;
      margin: 14px 0;
      page-break-inside: avoid;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 8pt;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .badge-success { background: #dcfce7; color: #15803d; }
    .badge-primary { background: #dbeafe; color: #1e40af; }
    .badge-warning { background: #fef3c7; color: #b45309; }

    .footer-note {
      margin-top: 30px;
      font-size: 8.5pt;
      color: #64748b;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
    }
  </style>
</head>
<body>

  <!-- CAPA -->
  <div class="cover-page">
    <div class="cover-header">
      <div class="cover-logo">
        <span>💚 LINSORA</span>
      </div>
      <div class="cover-subtitle">Plataforma de Gestão Financeira Pessoal Inteligente</div>
    </div>
    
    <div class="cover-main">
      <div class="cover-title">DOCUMENTAÇÃO TÉCNICA DO SISTEMA</div>
      <div class="cover-description">
        <strong>Especificação Arquitetural Completa & Guia de Engenharia</strong><br><br>
        Este documento contém o detalhamento da arquitetura de software, estrutura de dados, fluxos de autenticação híbrida (Google Auth Native / GIS / Supabase OAuth), esquema de banco de dados PostgreSQL com RLS, organização modular do frontend Vanilla JS e guia de build nativo Android via Capacitor 8.
      </div>
    </div>

    <div class="cover-footer">
      <div><strong>Versão do Sistema:</strong> 1.0.0 (MVP)</div>
      <div><strong>Autor:</strong> Equipe de Engenharia & Arquitetura LINSORA</div>
      <div><strong>Data de Emissão:</strong> 08 de Agosto de 2026</div>
    </div>
  </div>

  <!-- SEÇÃO 1: VISÃO GERAL -->
  <div class="page">
    <h1>1. Visão Geral do Sistema</h1>
    <p>
      O <strong>LINSORA Finances</strong> é uma solução moderna de gestão financeira pessoal desenvolvida com foco em alta performance, usabilidade responsiva e funcionamento híbrido (Web PWA e Android Nativo). O sistema permite o controle consolidado de contas bancárias, cartões de crédito, chaves Pix, planejamento de metas financeiras, controle de contas fixas e registro detalhado de transações (receitas e despesas).
    </p>

    <div class="info-card">
      <strong>🎯 Proposta de Valor & Diferenciais Técnicos:</strong>
      <ul>
        <li><strong>Arquitetura Offline-First Resiliente:</strong> Funcionalidade completa via <code>LocalStorage</code> com sincronização em nuvem automática e transparente quando conectado ao <code>Supabase Cloud</code>.</li>
        <li><strong>Autenticação Nativa de Alta Fidelidade:</strong> Suporte ao seletor nativo do Android (Google Play Services / Credential Manager) integrado via Capacitor GoogleAuth plugin com rotas de fallback resilientes (GIS e Supabase OAuth).</li>
        <li><strong>Segurança Extrema (Zero Data Leak):</strong> Políticas estritas de Row Level Security (RLS) no PostgreSQL do Supabase, garantindo isolamento total por <code>auth.uid()</code> em todas as tabelas.</li>
        <li><strong>Design System Premium Vanilla:</strong> Interface responsiva desenvolvida em CSS3 moderno com suporte a tema escuro/claro, glassmorphism e micro-animações.</li>
      </ul>
    </div>

    <h2>1.1 Casos de Uso Principais</h2>
    <table>
      <thead>
        <tr>
          <th>Módulo / Funcionalidade</th>
          <th>Descrição Técnica</th>
          <th>Fluxo de Dados</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Autenticação Híbrida</strong></td>
          <td>Login por e-mail/senha, Google Native SSO (Android) ou Google GIS (Web). Criação automática de perfil no primeiro acesso.</td>
          <td>Capacitor Plugin &rarr; Supabase Auth &rarr; Trigger PostgreSQL</td>
        </tr>
        <tr>
          <td><strong>Dashboard Consolidado</strong></td>
          <td>Visão panorâmica de saldo total, receitas/despesas do mês, atalhos rápidos e gráficos analíticos.</td>
          <td>LinsoraStore &rarr; Renderização DOM &rarr; Chart.js</td>
        </tr>
        <tr>
          <td><strong>Gestão de Contas e Cartões</strong></td>
          <td>Cadastro, edição e exclusão de contas correntes e cartões de crédito com cálculo automático de limite usado e faturas.</td>
          <td>CRUD LinsoraStore &rarr; Cloud Sync (Supabase <code>accounts</code> e <code>cards</code>)</td>
        </tr>
        <tr>
          <td><strong>Lançamento de Transações</strong></td>
          <td>Registro de receitas e despesas com categoria, data, forma de pagamento e parcelamento.</td>
          <td>Validation &rarr; LocalStorage &rarr; Supabase <code>transactions</code></td>
        </tr>
        <tr>
          <td><strong>Metas e Contas Fixas</strong></td>
          <td>Acompanhamento de progresso de economias e alerta de vencimento de contas fixas recorrentes.</td>
          <td>Notifications Engine &rarr; Visual Progress Renderer</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- SEÇÃO 2: STACK TECNOLÓGICA -->
  <div class="page">
    <h1>2. Stack Tecnológica & Dependências</h1>

    <div class="tech-grid">
      <div class="tech-item">
        <strong>🌐 Frontend Web Core</strong>
        <span>HTML5 Semântico, Vanilla JavaScript (ES6+ Modules & Classes), CSS3 Custom Properties (Design System sem frameworks CSS genéricos).</span>
      </div>

      <div class="tech-item">
        <strong>📱 Camada Nativa Mobile</strong>
        <span>Capacitor 8 Core & CLI (<code>@capacitor/core</code>, <code>@capacitor/android</code> v8.5.0), Android SDK, Gradle 8.14, Java 17 JDK.</span>
      </div>

      <div class="tech-item">
        <strong>☁️ Backend & Banco de Dados</strong>
        <span>Supabase Cloud (PostgreSQL 15), Supabase JS Client v2, Supabase Auth Service, Row Level Security (RLS) & Triggers PL/pgSQL.</span>
      </div>

      <div class="tech-item">
        <strong>🔐 Autenticação & Plugins</strong>
        <span><code>@codetrix-studio/capacitor-google-auth</code> (v3.4.0-rc.4), Google Identity Services (GIS JS SDK), Supabase OAuth Redirect.</span>
      </div>

      <div class="tech-item">
        <strong>📊 Gráficos & Utilitários</strong>
        <span>Chart.js v4 (Renderização Canvas), FontAwesome 6 (Ícones), Google Fonts (Inter / Outfit), ServiceWorker PWA.</span>
      </div>

      <div class="tech-item">
        <strong>🧪 Testes & Automação</strong>
        <span>Playwright E2E Test Suite (<code>@playwright/test</code> v1.40.0), PowerShell Scripting para Server Local e Gradle Builder.</span>
      </div>
    </div>

    <h2>2.1 Configuração de Dependências (package.json)</h2>
    <div class="code-block">
      <pre><code>{
  "name": "linsora-finance-mvp",
  "version": "1.0.0",
  "dependencies": {
    "@capacitor/android": "^8.5.0",
    "@capacitor/cli": "^8.5.0",
    "@capacitor/core": "^8.5.0",
    "@codetrix-studio/capacitor-google-auth": "^3.4.0-rc.4"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0"
  }
}</code></pre>
    </div>
  </div>

  <!-- SEÇÃO 3: ARQUITETURA E FLUXOS -->
  <div class="page">
    <h1>3. Arquitetura e Fluxos do Sistema</h1>
    <p>
      O LINSORA utiliza uma arquitetura em camadas bem delimitada. O frontend interage com os módulos internos de estado (<code>LinsoraStore</code>), que por sua vez realizam o roteamento de persistência entre a camada local (<code>LocalStorage</code>) e o repositório remoto (<code>SupabaseRepository</code>).
    </p>

    <h2>3.1 Diagrama Geral da Arquitetura</h2>
    <div class="diagram-container">
      <div class="diagram-title">📱 ARQUITETURA LINSORA (HYBRID MOBILE & WEB)</div>
[ INTERFACE DO USUÁRIO - HTML5 / CSS3 / Vanilla JS ]
     │
     ├──► [ LinsoraUI (components.js) ] ──► Renderização e Eventos DOM
     │
     ├──► [ LinsoraStore (store.js) ] ──► Gerenciador de Estado Reativo
     │          │
     │          ├──► [ LocalStorage ] ──► Cache Offline Instantâneo
     │          │
     │          └──► [ SupabaseRepository (supabase-client.js) ]
     │                     │
     │                     └──► [ Supabase Cloud PostgreSQL + RLS ]
     │
     └──► [ LinsoraGoogleAuth (google-auth.js) ]
                │
                ├──► (Android Native)  ──► Capacitor GoogleAuth Plugin (OAuth 2.0)
                ├──► (Web Browser)     ──► Google Identity Services (GIS)
                └──► (OAuth Fallback)  ──► Supabase OAuth Redirect
    </div>

    <h2>3.2 Fluxo de Autenticação Google Híbrido (Resiliente)</h2>
    <p>
      Para garantir 100% de disponibilidade em qualquer ambiente (Android nativo ou navegadores Web), o módulo <code>google-auth.js</code> implementa um mecanismo de tentativa e fallback em 3 camadas:
    </p>

    <div class="diagram-container">
      <div class="diagram-title">🔄 FLUXO DE DECISÃO DE LOGIN GOOGLE</div>
1. Clique em "Entrar com Google" (btnGoogleAuth)
   │
   ├──► [ É plataforma Nativa Android? ] 
   │        │
   │        ├──► SIM: Chama capacitorGoogleAuthPlugin.signIn({ scopes: ['profile', 'email'] })
   │        │          ├──► Sucesso: Extrai profile e grava sessão no LinsoraStore
   │        │          └──► Erro/Cancelamento: Trata erro ou prossegue para fallback GIS
   │        │
   │        └──► NÃO: Prossegue para GIS / Web
   │
   ├──► [ Google Identity Services (GIS) disponível no window? ]
   │        │
   │        ├──► SIM: Executa window.google.accounts.id.prompt()
   │        │          ├──► Sucesso: Decodifica JWT idToken e obtém dados do usuário
   │        │          └──► Indisponível/Timeout: Prossegue para Supabase OAuth
   │        │
   │        └──► NÃO: Prossegue para Supabase OAuth
   │
   └──► [ Fallback Supabase OAuth Redirect ]
            └──► Executa supabase.auth.signInWithOAuth({ provider: 'google' })
    </div>
  </div>

  <!-- SEÇÃO 4: BANCO DE DADOS E RLS -->
  <div class="page">
    <h1>4. Estrutura de Banco de Dados e Segurança (PostgreSQL / RLS)</h1>
    <p>
      O modelo relacional do LINSORA foi projetado para alta escalabilidade e isolamento estrito de dados. Todas as tabelas possuem <code>Row Level Security (RLS)</code> ativado, permitindo que cada usuário acesse exclusivamente seus próprios registros baseando-se no token JWT validado pelo <code>auth.uid()</code>.
    </p>

    <h2>4.1 Dicionário de Dados</h2>
    <table>
      <thead>
        <tr>
          <th>Tabela</th>
          <th>Coluna Principal</th>
          <th>Tipo</th>
          <th>Regra de Chave Estrangeira / RLS</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>profiles</code></td>
          <td>id</td>
          <td>UUID (PK)</td>
          <td><code>REFERENCES auth.users(id) ON DELETE CASCADE</code>. Isolado por <code>auth.uid() = id</code>.</td>
        </tr>
        <tr>
          <td><code>accounts</code></td>
          <td>id, user_id</td>
          <td>UUID (PK, FK)</td>
          <td>Contas Bancárias. FK para <code>auth.users(id)</code>. RLS: <code>auth.uid() = user_id</code>.</td>
        </tr>
        <tr>
          <td><code>cards</code></td>
          <td>id, user_id</td>
          <td>UUID (PK, FK)</td>
          <td>Cartões de Crédito (limites e vencimentos). RLS: <code>auth.uid() = user_id</code>.</td>
        </tr>
        <tr>
          <td><code>pix_keys</code></td>
          <td>id, user_id</td>
          <td>UUID (PK, FK)</td>
          <td>Chaves Pix cadastradas (CPF, Email, Telefone, Aleatória).</td>
        </tr>
        <tr>
          <td><code>goals</code></td>
          <td>id, user_id</td>
          <td>UUID (PK, FK)</td>
          <td>Metas financeiras de economia com valor alvo e valor atual.</td>
        </tr>
        <tr>
          <td><code>fixed_bills</code></td>
          <td>id, user_id</td>
          <td>UUID (PK, FK)</td>
          <td>Contas fixas mensais recorrentes com dia de vencimento.</td>
        </tr>
        <tr>
          <td><code>transactions</code></td>
          <td>id, user_id</td>
          <td>UUID (PK, FK)</td>
          <td>Lançamentos de Receitas e Despesas com status e categorias.</td>
        </tr>
      </tbody>
    </table>

    <h2>4.2 Trigger Autônomo de Criação de Perfil</h2>
    <div class="code-block">
      <pre><code>-- Trigger PL/pgSQL executado automaticamente ao registrar novo usuário no Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();</code></pre>
    </div>
  </div>

  <!-- SEÇÃO 5: ESTRUTURA DE PASTAS E MÓDULOS -->
  <div class="page">
    <h1>5. Estrutura de Pastas e Módulos do Código</h1>
    <p>
      O projeto segue uma estrutura organizacional desacoplada, separando recursos estáticos, lógicas de negócios, artefatos de compilação nativa e arquivos de teste.
    </p>

    <div class="code-block">
      <pre><code>FINANCEMVP/
├── android/                        # Projeto Android Nativo (Gradle / Android Studio)
│   ├── app/src/main/
│   │   ├── java/com/linsora/app/   # MainActivity.java (Registro de Plugins Capacitor)
│   │   └── AndroidManifest.xml     # Permissões da Internet e configurações de app
│   └── gradlew.bat                 # Gradle Wrapper para automação de builds
├── css/
│   └── styles.css                  # Design System completo e estilos globais (70KB)
├── js/
│   ├── app.js                      # Roteador principal, rotinas de inicialização e eventos
│   ├── store.js                    # LinsoraStore: Gestor de estado reativo e LocalStorage
│   ├── supabase-client.js          # Client Supabase e camada de sincronização em nuvem
│   ├── google-auth.js              # LinsoraGoogleAuthManager (Android Native & GIS SSO)
│   ├── components.js               # LinsoraUI: Componentes reutilizáveis, Modais e Toasts
│   ├── utils.js                    # Funções utilitárias (Formatação BRL, Datas, Export PDF/CSV)
│   ├── charts.js                   # Renderizador de gráficos interativos com Chart.js
│   ├── logger.js                   # Módulo central de logs e depuração do sistema
│   └── notifications.js            # Notificações visuais e agendamento de alertas
├── tests/                          # Suite de Testes Automatizados E2E (Playwright)
│   └── 04_accounts_cards.spec.js   # Testes de integração de contas e cartões
├── www/                            # Diretório de distribuição compilado para o Capacitor
├── index.html                      # Layout principal Single Page Application (SPA)
├── capacitor.config.json           # Configuração global de IDs e Plugins do Capacitor
├── supabase_schema_rls.sql         # Script SQL oficial com tabelas, RLS e Triggers
├── server.ps1                      # Servidor HTTP local para desenvolvimento (PowerShell)
├── package.json                    # Gerenciador de dependências e scripts npm
└── LINSORA-Financas.apk            # Pacote APK final de diagnóstico compilado</code></pre>
    </div>

    <h2>5.1 Responsabilidade dos Módulos JavaScript</h2>
    <table>
      <thead>
        <tr>
          <th>Módulo JS</th>
          <th>Tamanho</th>
          <th>Principais Responsabilidades</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>app.js</code></td>
          <td>~42 KB</td>
          <td>Controle de fluxo de telas, binding de formulários, modais e inicialização de instâncias.</td>
        </tr>
        <tr>
          <td><code>components.js</code></td>
          <td>~26 KB</td>
          <td>Renderização dinâmica de tabelas de transações, cards de saldo, toasts e modais.</td>
        </tr>
        <tr>
          <td><code>store.js</code></td>
          <td>~19 KB</td>
          <td>Gerenciamento de estado reativo em memória com sincronização bidirecional no <code>LocalStorage</code>.</td>
        </tr>
        <tr>
          <td><code>supabase-client.js</code></td>
          <td>~18 KB</td>
          <td>Comunicação REST/Realtime com Supabase, fallback gracioso offline e hash de IDs.</td>
        </tr>
        <tr>
          <td><code>google-auth.js</code></td>
          <td>~12 KB</td>
          <td>Gerenciamento de OAuth nativo Google (Play Services) e web Identity Services (GIS).</td>
        </tr>
        <tr>
          <td><code>utils.js</code></td>
          <td>~10 KB</td>
          <td>Formatação de moeda BRL, formatação de datas ISO, máscaras de input e geradores de ID.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- SEÇÃO 6: GUIA DE CONFIGURAÇÃO E BUILD -->
  <div class="page">
    <h1>6. Guia de Configuração, Compilação e Build</h1>

    <h2>6.1 Pré-requisitos do Ambiente de Desenvolvimento</h2>
    <ul>
      <li><strong>Node.js:</strong> Versão v18.x ou superior (com <code>npm</code>).</li>
      <li><strong>Java Development Kit (JDK):</strong> JDK 17 (Requerido pelo Gradle do Android).</li>
      <li><strong>Android SDK:</strong> Build-Tools 34.0.0+, Platform-Tools e Android SDK Command-line Tools.</li>
      <li><strong>PowerShell:</strong> Versão 5.1 ou superior (para execução de scripts de build automatizados).</li>
    </ul>

    <h2>6.2 Comandos de Compilação e Automação (npm scripts)</h2>
    <table>
      <thead>
        <tr>
          <th>Comando NPM</th>
          <th>Ação Executada</th>
          <th>Resultado Gerado</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>npm start</code></td>
          <td>Executa o servidor PowerShell local em <code>server.ps1</code> na porta 8080.</td>
          <td>Aplicação acessível localmente via HTTP.</td>
        </tr>
        <tr>
          <td><code>npm run build:cap</code></td>
          <td>Copia arquivos (<code>index.html</code>, <code>js/</code>, <code>css/</code>) para <code>www/</code> e executa <code>npx cap sync android</code>.</td>
          <td>Sincronização completa de assets com o projeto Android nativo.</td>
        </tr>
        <tr>
          <td><code>npm run build:apk</code></td>
          <td>Sincroniza assets web e executa o <code>gradlew assembleDebug</code> com as variáveis de ambiente JDK/SDK corretas.</td>
          <td>Gera o arquivo <strong>LINSORA-Financas.apk</strong> na raiz do projeto.</td>
        </tr>
        <tr>
          <td><code>npm test</code></td>
          <td>Executa a suíte completa de testes automatizados E2E via Playwright.</td>
          <td>Relatório de validação de testes E2E.</td>
        </tr>
      </tbody>
    </table>

    <h2>6.3 Variáveis de Ambiente e Chaves de Integração</h2>
    <div class="info-card">
      <strong>⚠️ Credenciais e Chaves de API Configuradas:</strong>
      <ul>
        <li><strong>Google OAuth Client ID:</strong> <code>465194772971-m698u5l0n7u3n311cbn8oha0rfn6staq.apps.googleusercontent.com</code> (Configurado em <code>capacitor.config.json</code> e <code>google-auth.js</code>).</li>
        <li><strong>Supabase Project URL:</strong> <code>https://npsynxedtzjixnlyzbsu.supabase.co</code> (Configurado em <code>js/supabase-client.js</code>).</li>
        <li><strong>Supabase Anon Key:</strong> Configurada no módulo <code>supabase-client.js</code> para acesso seguro via RLS.</li>
      </ul>
    </div>

    <div class="footer-note">
      Documentação Técnica Oficial LINSORA Finances • Gerada Automaticamente em 08/08/2026
    </div>
  </div>

</body>
</html>
  `;

  const outputPath = path.join('c:', 'Users', 'Urso', 'Documents', 'FINANCEMVP', 'LINSORA-Documentacao-Tecnica.pdf');

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setContent(htmlContent, { waitUntil: 'networkidle' });

  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '12mm',
      bottom: '15mm',
      left: '12mm',
      right: '12mm'
    }
  });

  await browser.close();
  console.log('PDF gerado com sucesso em:', outputPath);
}

generatePDF().catch(err => {
  console.error('Erro ao gerar PDF:', err);
  process.exit(1);
});
