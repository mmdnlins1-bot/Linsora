/**
 * ============================================================================
 * LINSORA — CAMADA DE CLIENTE & REPOSITÓRIO SUPABASE AUTH (supabase-client.js)
 * Fluxo de Autenticação Oficial, Logout Seguro e Sincronização PostgreSQL / RLS
 * ============================================================================
 */

/**
 * Cache síncrono em memória para o storage adapter do Supabase SDK v2.
 *
 * O Supabase JS SDK chama storage.getItem() de forma SÍNCRONA durante o
 * createClient(). Se getItem() retornar uma Promise (como faz o Capacitor
 * Preferences), o SDK recebe "[object Promise]" como valor do token — que é
 * inválido — e descarta a sessão silenciosamente. Este cache resolve o problema:
 *   1. É populado antes da instanciação do cliente (via warmUpStorage)
 *   2. Retorna valores síncronos para o SDK
 *   3. Persiste assincronamente em localStorage + Capacitor Preferences
 */
const _supabaseMemCache = {};

// Pré-popula o cache com todas as chaves sb-* já presentes no localStorage
// (garante que re-inicializações do SDK encontrem o token imediatamente)
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('sb-') || k === 'supabase.auth.token')) {
      _supabaseMemCache[k] = localStorage.getItem(k);
    }
  }
} catch(e) { /* falha silenciosa — não impede o boot */ }

const IDB_STORE = 'linsora_auth';
function getAuthDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('LinsoraSecureDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, val) {
  try {
    const db = await getAuthDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
    });
  } catch(e) {}
}
async function idbGet(key) {
  try {
    const db = await getAuthDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch(e) { return null; }
}
async function idbRemove(key) {
  try {
    const db = await getAuthDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
    });
  } catch(e) {}
}

class SupabaseRepository {
  constructor() {
    this.configKey = 'LINSORA_SUPABASE_CONFIG';
    this.config = this.getSupabaseConfig();
    this.supabase = null;
    this.currentUserId = 'guest';
    // Inicialização única e controlada: o boot (app.js) executa
    // `await warmUpStorage()` e depois `initSupabaseSDK()` uma única vez.
    // O construtor NÃO cria o cliente, para não inicializar antes do warm-up
    // (o que descartaria o token persistido) nem registrar listeners duplicados.
    this._sdkInitKey = null;
    this._authSubscription = null;
  }

  /**
   * Acesso unificado ao Capacitor Preferences.
   * Usa a MESMA camada para persistir e recuperar (resolve a divergência
   * entre a API antiga `Capacitor.Plugins.Preferences` e a nova
   * `Capacitor.Preferences`). No navegador/PWA sem Capacitor, retorna null
   * e o chamador usa localStorage como base.
   */
  _prefsPlugin() {
    if (window.Capacitor?.Plugins?.Preferences) return window.Capacitor.Plugins.Preferences;
    if (window.Capacitor?.Preferences) return window.Capacitor.Preferences;
    return null;
  }

  async _prefsGet(key) {
    try {
      const plugin = this._prefsPlugin();
      if (!plugin) return null;
      const res = await plugin.get({ key }).catch(() => ({}));
      return (res && typeof res.value === 'string') ? res.value : null;
    } catch (e) {
      return null;
    }
  }

  async _prefsSet(key, value) {
    try {
      const plugin = this._prefsPlugin();
      if (!plugin) return;
      await plugin.set({ key, value }).catch(() => {});
    } catch (e) { /* persistência best-effort */ }
  }

  async _prefsRemove(key) {
    try {
      const plugin = this._prefsPlugin();
      if (!plugin) return;
      await plugin.remove({ key }).catch(() => {});
    } catch (e) { /* remoção best-effort */ }
  }

  async _prefsKeys() {
    try {
      const plugin = this._prefsPlugin();
      if (!plugin || typeof plugin.keys !== 'function') return [];
      const res = await plugin.keys().catch(() => ({}));
      return (res && Array.isArray(res.keys)) ? res.keys : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Pré-carrega as chaves de sessão do storage persistente para o _supabaseMemCache
   * ANTES de instanciar o Supabase Client. Isso garante que storage.getItem()
   * retorne o token de forma síncrona quando o SDK inicializar.
   *
   * Deve ser chamado com `await` antes de initSupabaseSDK().
   * Carrega TODAS as chaves `sb-*` (não apenas uma), descobrindo via `keys()`
   * as que existam somente no Capacitor Preferences (caso Android).
   */
  async warmUpStorage() {
    try {
      const wanted = new Set();
      // 1. Chave da sessão derivada da URL do projeto (quando configurada)
      if (this.config && this.config.url) {
        try {
          const urlHost = new URL(this.config.url).hostname;
          const projectRef = urlHost.split('.')[0];
          if (projectRef) wanted.add(`sb-${projectRef}-auth-token`);
        } catch (e) { /* URL inválida: ignora chave derivada */ }
      }
      // 2. Chaves sb-* já conhecidas (ex: vindas do localStorage no boot)
      Object.keys(_supabaseMemCache).forEach(k => {
        if (k.startsWith('sb-') || k === 'supabase.auth.token') wanted.add(k);
      });
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('sb-') || k === 'supabase.auth.token')) wanted.add(k);
        }
      } catch (e) { /* localStorage indisponível */ }
      // 3. Chaves existentes somente no Capacitor Preferences (Android)
      const prefKeys = await this._prefsKeys();
      prefKeys.forEach(k => {
        if (k && (k.startsWith('sb-') || k === 'supabase.auth.token')) wanted.add(k);
      });

      let loaded = 0;
      for (const key of wanted) {
        if (key in _supabaseMemCache && _supabaseMemCache[key] != null) continue;
        const fromPrefs = await this._prefsGet(key);
        const value = fromPrefs != null ? fromPrefs : (() => {
          try { return localStorage.getItem(key); } catch (e) { return null; }
        })();
        if (value != null) {
          _supabaseMemCache[key] = value;
          try { localStorage.setItem(key, value); } catch (e) { /* espelho best-effort */ }
          loaded++;
        }
      }
      console.log(`[LINSORA Auth] warmUpStorage: ${loaded} chave(s) de sessão carregada(s) para memCache.`);
    } catch (e) {
      console.warn('[LINSORA Auth] warmUpStorage falhou (não crítico):', e);
    }
  }

  /**
   * Inicializa o Supabase SDK de forma síncrona (INICIALIZAÇÃO ÚNICA).
   * IMPORTANTE: Para que a sessão persista no Android, chame `await warmUpStorage()`
   * ANTES de chamar este método pela primeira vez (o boot em app.js já faz isso).
   * Chamadas repetidas com a mesma configuração são ignoradas (sem recriar o
   * cliente e sem registrar listeners duplicados de onAuthStateChange).
   */
  initSupabaseSDK() {
    // Recarrega a configuração (permite override via saveSupabaseConfig após o boot)
    this.config = this.getSupabaseConfig();
    const initKey = `${this.config.url || ''}|${this.config.key || ''}`;
    if (this.supabase && this._sdkInitKey === initKey) {
      return; // já inicializado com esta configuração: nada a fazer
    }
    // Troca de configuração: remove o listener anterior antes de recriar
    if (this._authSubscription) {
      try {
        if (typeof this._authSubscription.unsubscribe === 'function') this._authSubscription.unsubscribe();
      } catch (e) { /* ignora */ }
      this._authSubscription = null;
    }
    if (this.config.url && this.config.key && window.supabase) {
      try {
        /**
         * Storage adapter com cache síncrono em memória.
         *
         * CRÍTICO: O Supabase JS SDK v2 chama getItem() de forma SÍNCRONA
         * durante createClient(). O retorno deve ser o valor diretamente (string | null),
         * não uma Promise. O _supabaseMemCache (pré-populado por warmUpStorage) garante
         * o retorno síncrono correto.
         *
         * setItem/removeItem persistem assincronamente em localStorage + Capacitor
         * Preferences para durabilidade entre sessões do app.
         */
        const capacitorStorage = {
          getItem: (key) => {
            // Retorno síncrono — crítico para o Supabase SDK v2
            if (key in _supabaseMemCache) return _supabaseMemCache[key];
            return localStorage.getItem(key);
          },
          setItem: (key, value) => {
            // Atualiza cache síncrono imediatamente
            _supabaseMemCache[key] = value;
            // Persiste em localStorage (síncrono e confiável no navegador/PWA)
            try { localStorage.setItem(key, value); } catch (e) { /* sem localStorage */ }
            // Espelha no Capacitor Preferences (durável no Android).
            // Fire-and-forget proposital: o SDK exige setItem síncrono.
            this._prefsSet(key, value);
          },
          removeItem: (key) => {
            delete _supabaseMemCache[key];
            try { localStorage.removeItem(key); } catch (e) { /* sem localStorage */ }
            this._prefsRemove(key);
          }
        };

        this.supabase = window.supabase.createClient(this.config.url, this.config.key, {
          auth: {
            storage: capacitorStorage,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
          }
        });
        console.log('⚡ Supabase Client SDK inicializado com memCache síncrono e suporte a Capacitor Preferences!');

        // Listener reativo único para manter memCache e currentUserId sincronizados
        // com o ciclo de vida do token (refresh, expiração, logout).
        // A inscrição é guardada para permitir unsubscribe em re-inicializações.
        const _authStateResult = this.supabase.auth.onAuthStateChange(async (event, session) => {
          console.log('[LINSORA Auth] onAuthStateChange:', event, session?.user?.id || 'no-user');

          if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
            // Limpa memCache de todas as chaves de sessão Supabase
            Object.keys(_supabaseMemCache).forEach(k => {
              if (k.startsWith('sb-')) delete _supabaseMemCache[k];
            });
            // S8C: cobre eventos externos de logout (ex: expiração remota):
            // limpa o cache financeiro do usuário deslogado e o estado em memória.
            this.removeUserFinancialCache(this.currentUserId);
            if (window.linsoraStore) window.linsoraStore.clearState();
            this.currentUserId = 'guest';
            await this.removeActiveLocalSession();
            // Redireciona para tela de login se o app estiver visível
            const main = document.getElementById('appMain');
            if (main && main.classList.contains('active')) {
              main.classList.remove('active');
              main.classList.add('hidden');
              const auth = document.getElementById('authScreen');
              if (auth) { auth.classList.remove('hidden'); auth.classList.add('active'); }
            }
          } else if (event === 'TOKEN_REFRESHED' && session) {
            // Garante que o novo token seja refletido no memCache
            this.currentUserId = session.user.id;
            console.log('[LINSORA Auth] Token renovado automaticamente para usuário:', session.user.id);
          } else if (event === 'SIGNED_IN' && session?.user) {
            this.currentUserId = session.user.id;
          }
        });
        const _authListenerData = (_authStateResult && _authStateResult.data) || null;
        this._authSubscription = (_authListenerData && _authListenerData.subscription) || null;
        this._sdkInitKey = initKey;

      } catch (e) {
        console.warn('[LINSORA Auth] Erro ao inicializar Supabase SDK:', e);
      }
    }
  }

  _readMetaContent(name) {
    try {
      // Pode haver mais de uma tag (placeholder vazio do HTML + valor injetado
      // pelo build): retorna o primeiro conteúdo NÃO vazio encontrado.
      const els = document.querySelectorAll(`meta[name="${name}"]`);
      for (const el of els) {
        const content = (el.getAttribute('content') || '').trim();
        if (content) return content;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Configuração do Supabase em build time, sem segredos no código-fonte.
   * Fontes, por prioridade:
   *   1. Override manual em localStorage (`LINSORA_SUPABASE_CONFIG`, via saveSupabaseConfig)
   *   2. Meta tags de build (`linsora:supabase-url` / `linsora:supabase-anon-key`)
   *   3. Globais injetadas (`window.__LINSORA_SUPABASE_URL__` /
   *      `window.__LINSORA_SUPABASE_ANON_KEY__` ou
   *      `window.__LINSORA_SUPABASE__ = { url, anonKey }`)
   * Somente URL pública + anon/public key. NUNCA service_role no frontend.
   */
  getSupabaseConfig() {
    const empty = { url: '', key: '', isConnected: false };
    const normalize = (url, key) => {
      const cleanUrl = String(url || '').trim();
      const cleanKey = String(key || '').trim();
      if (!cleanUrl || !cleanKey) return empty;
      return { url: cleanUrl, key: cleanKey, isConnected: true };
    };

    // 1. Override manual (ex: configurado uma vez via saveSupabaseConfig)
    try {
      const stored = localStorage.getItem(this.configKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.url && parsed.key) {
          return { url: parsed.url, key: parsed.key, isConnected: Boolean(parsed.url && parsed.key) };
        }
      }
    } catch (e) { /* sem override válido: tenta próximas fontes */ }

    // 2. Meta tags de build (Vercel / build Capacitor preenchem o content)
    const metaUrl = this._readMetaContent('linsora:supabase-url');
    const metaKey = this._readMetaContent('linsora:supabase-anon-key');
    if (metaUrl && metaKey) return normalize(metaUrl, metaKey);

    // 3. Globais injetadas antes do carregamento dos scripts
    try {
      const injected = window.__LINSORA_SUPABASE__ || {};
      const winUrl = window.__LINSORA_SUPABASE_URL__ || injected.url;
      const winKey = window.__LINSORA_SUPABASE_ANON_KEY__ || injected.anonKey || injected.key;
      if (winUrl && winKey) return normalize(winUrl, winKey);
    } catch (e) { /* sem injeção: segue sem configuração */ }

    return empty;
  }

  saveSupabaseConfig(url, key) {
    this.config = { url, key, isConnected: Boolean(url && key) };
    localStorage.setItem(this.configKey, JSON.stringify(this.config));
    this.initSupabaseSDK();
    return this.config;
  }

  /* ------------------------------------------------------------------------
     AUTENTICAÇÃO E SESSÃO DO USUÁRIO
     ------------------------------------------------------------------------ */

  async saveActiveLocalSession(userProfile) {
    try {
      if (userProfile && userProfile.id) {
        const val = JSON.stringify(userProfile);
        // Triple-layer storage for bulletproof persistence
        await idbSet('LINSORA_ACTIVE_LOCAL_SESSION', val);
        try { localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', val); } catch (e) { /* sem localStorage */ }
        // Mesma camada de Preferences usada pelo warm-up/storage do Supabase
        await this._prefsSet('LINSORA_ACTIVE_LOCAL_SESSION', val);
      }
    } catch (e) {
      console.warn('Falha ao salvar sessão local:', e);
    }
  }

  async getActiveLocalSession() {
    try {
      let raw = await idbGet('LINSORA_ACTIVE_LOCAL_SESSION');
      if (!raw) {
        // Mesma camada de Preferences usada na persistência e no warm-up
        raw = await this._prefsGet('LINSORA_ACTIVE_LOCAL_SESSION');
      }
      if (!raw) {
        try { raw = localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) { /* sem localStorage */ }
      }
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async removeActiveLocalSession() {
    try {
      await idbRemove('LINSORA_ACTIVE_LOCAL_SESSION');
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) { /* sem localStorage */ }
      await this._prefsRemove('LINSORA_ACTIVE_LOCAL_SESSION');
    } catch (e) {
      console.warn('Falha ao limpar sessão local:', e);
    }
  }

  /**
   * S8C: remove o snapshot financeiro local (LINSORA_DB_CACHE_<id>) do usuário
   * que está saindo. Preciso: só a chave do próprio userId; caches de
   * visitante (guest), preferências e controles de segurança são preservados.
   */
  removeUserFinancialCache(userId) {
    if (!userId || userId === 'guest' || userId === 'usr_guest') return false;
    try {
      localStorage.removeItem(`LINSORA_DB_CACHE_${userId}`);
      return true;
    } catch (e) {
      if (window.LinsoraLogger) window.LinsoraLogger.error('Falha ao limpar cache financeiro local', e, userId);
      return false;
    }
  }

  async checkActiveSession() {
    console.log('[LINSORA Auth] checkActiveSession: iniciando verificação de sessão...');

    if (this.supabase) {
      try {
        const { data: { session }, error } = await this.supabase.auth.getSession();

        if (error) {
          // Erro TRANSITÓRIO de leitura (rede, storage momentaneamente indisponível):
          // NÃO apaga a sessão persistida aqui. Segue para o fallback local abaixo
          // e deixa o autoRefreshToken do SDK tentar renovar. A sessão local só é
          // removida no logout real (signOut / evento SIGNED_OUT).
          console.warn('[LINSORA Auth] Erro ao ler sessão Supabase (sem wipe, tentando fallback):', error.message);
        } else if (session && session.user) {
          this.currentUserId = session.user.id;
          const userMeta = session.user.user_metadata || {};
          const db = await this.getDbData(session.user.id, {
            id: session.user.id,
            name: userMeta.full_name || userMeta.name || session.user.email.split('@')[0],
            email: session.user.email,
            avatar: userMeta.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'
          });
          await this.saveActiveLocalSession(db.user);
          console.log('[LINSORA Auth] Sessão Supabase válida encontrada para:', session.user.email);
          return { success: true, user: db.user, db };
        }

        // Supabase não retornou sessão — sem token ou expirado sem refresh possível
        console.log('[LINSORA Auth] Nenhuma sessão Supabase ativa. Verificando sessão local de fallback...');
      } catch (e) {
        console.warn('[LINSORA Auth] Exceção ao verificar sessão Supabase:', e);
      }
    }

    // Fallback: sessão local salva (modo offline ou Supabase não configurado)
    const localSession = await this.getActiveLocalSession();
    if (localSession && localSession.id) {
      this.currentUserId = localSession.id;
      const db = await this.getDbData(localSession.id, localSession);
      console.log('[LINSORA Auth] Sessão local encontrada para userId:', localSession.id);
      return { success: true, user: db.user, db };
    }

    console.log('[LINSORA Auth] Nenhuma sessão ativa encontrada. Usuário deve fazer login.');
    return { success: false };
  }

  generateLocalUserId(email) {
    if (!email) return 'usr_guest';
    const clean = String(email).toLowerCase().trim();
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = ((hash << 5) - hash) + clean.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    let safeBtoa = '';
    try {
      safeBtoa = btoa(encodeURIComponent(clean)).replace(/=/g, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    } catch (e) {
      safeBtoa = 'usr';
    }
    return `usr_${hex}_${safeBtoa}`;
  }

  getLocalRegisteredUsers() {
    try {
      const stored = localStorage.getItem('LINSORA_REGISTERED_USERS');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  }

  saveLocalRegisteredUser(userRecord) {
    try {
      const users = this.getLocalRegisteredUsers();
      users[userRecord.email] = userRecord;
      localStorage.setItem('LINSORA_REGISTERED_USERS', JSON.stringify(users));
    } catch (e) {
      if (window.LinsoraLogger) window.LinsoraLogger.error('Falha ao salvar registro local de usuário', e);
    }
  }

  /* ------------------------------------------------------------------------
     HASHING LOCAL DE SENHA (PBKDF2 via Web Crypto API)
     Sem dependências externas — compatível com WebView Android (Capacitor)
     Formato armazenado: "pbkdf2:<saltBase64>:<hashBase64>"
     OWASP recomenda PBKDF2-SHA256 com >= 100.000 iterações quando bcrypt/Argon2
     não estão disponíveis nativamente no ambiente.
     ------------------------------------------------------------------------ */

  async hashLocalPassword(password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(String(password)),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const toBase64 = (buffer) => {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    };
    return `pbkdf2:${toBase64(salt)}:${toBase64(hashBuffer)}`;
  }

  async verifyLocalPassword(password, storedHash) {
    try {
      if (!storedHash || !storedHash.startsWith('pbkdf2:')) return false;
      const parts = storedHash.split(':');
      if (parts.length !== 3) return false;
      const saltBytes = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(String(password)),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        256
      );
      let binary = '';
      const bytes = new Uint8Array(hashBuffer);
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const newHashB64 = btoa(binary);
      return newHashB64 === parts[2];
    } catch (e) {
      if (window.LinsoraLogger) window.LinsoraLogger.error('Erro ao verificar hash de senha local', e);
      return false;
    }
  }

  /* ------------------------------------------------------------------------
     RATE LIMITING LOCAL — Proteção contra força bruta no modo offline
     Chave no localStorage: "LINSORA_LOGIN_ATTEMPTS"
     Estrutura por email: { count: N, lockedUntil: timestamp|null }
     ------------------------------------------------------------------------ */

  _getLoginAttempts(email) {
    try {
      const raw = localStorage.getItem('LINSORA_LOGIN_ATTEMPTS');
      const store = raw ? JSON.parse(raw) : {};
      return store[email] || { count: 0, lockedUntil: null };
    } catch (e) {
      return { count: 0, lockedUntil: null };
    }
  }

  _recordFailedAttempt(email) {
    try {
      const raw = localStorage.getItem('LINSORA_LOGIN_ATTEMPTS');
      const store = raw ? JSON.parse(raw) : {};
      const entry = store[email] || { count: 0, lockedUntil: null };
      entry.count += 1;
      // Após 5 tentativas consecutivas incorretas: bloquear por 15 minutos
      if (entry.count >= 5) {
        entry.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 min em ms
      }
      store[email] = entry;
      localStorage.setItem('LINSORA_LOGIN_ATTEMPTS', JSON.stringify(store));
      return entry;
    } catch (e) {
      return { count: 1, lockedUntil: null };
    }
  }

  _clearLoginAttempts(email) {
    try {
      const raw = localStorage.getItem('LINSORA_LOGIN_ATTEMPTS');
      if (!raw) return;
      const store = JSON.parse(raw);
      delete store[email];
      localStorage.setItem('LINSORA_LOGIN_ATTEMPTS', JSON.stringify(store));
    } catch (e) {
      // falha silenciosa: não bloquear o fluxo de login por isso
    }
  }

  async signInWithEmail(email, password) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (window.LinsoraLogger) window.LinsoraLogger.auth('Iniciando signInWithEmail', { email: cleanEmail });

    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        this.currentUserId = data.user.id;
        const db = await this.getDbData(data.user.id, { id: data.user.id, email: data.user.email, name: cleanEmail.split('@')[0] });
        await this.saveActiveLocalSession(db.user);
        if (window.LinsoraLogger) window.LinsoraLogger.auth('signInWithEmail Supabase com sucesso', { email: cleanEmail }, data.user.id);
        return { success: true, user: db.user };
      } catch (err) {
        const errMsg = this.mapAuthErrorMessage(err.message);
        if (window.LinsoraLogger) window.LinsoraLogger.error('Falha no signInWithEmail Supabase', errMsg);
        return { success: false, message: errMsg };
      }
    }

    const registeredUsers = this.getLocalRegisteredUsers();
    const existing = registeredUsers[cleanEmail];

    // --- RATE LIMITING: verificar bloqueio antes de qualquer operação de senha ---
    const attempt = this._getLoginAttempts(cleanEmail);
    if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
      const remainingMs = attempt.lockedUntil - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      const msg = `Conta bloqueada por tentativas excessivas. Tente novamente em ${remainingMin} minuto${remainingMin !== 1 ? 's' : ''}.`;
      if (window.LinsoraLogger) window.LinsoraLogger.error('Login bloqueado por rate limit', { email: cleanEmail, remainingMin });
      return { success: false, message: msg, locked: true, remainingMs };
    }
    // Se o bloqueio já expirou, limpar o contador e permitir nova tentativa
    if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
      this._clearLoginAttempts(cleanEmail);
    }

    if (existing) {
      // Verificação de senha com suporte a hash PBKDF2 e migração automática de senhas legadas
      let isMatch = false;
      if (existing.passwordHash && existing.passwordHash.startsWith('pbkdf2:')) {
        // Caminho seguro: senha já está em PBKDF2
        isMatch = await this.verifyLocalPassword(password, existing.passwordHash);
      } else if (existing.password) {
        // Legado: senha em texto puro — comparar e migrar para hash imediatamente
        isMatch = (existing.password === password);
        if (isMatch) {
          try {
            const hashedPwd = await this.hashLocalPassword(password);
            const allUsers = this.getLocalRegisteredUsers();
            allUsers[cleanEmail] = { ...existing, passwordHash: hashedPwd, password: undefined };
            localStorage.setItem('LINSORA_REGISTERED_USERS', JSON.stringify(allUsers));
            if (window.LinsoraLogger) window.LinsoraLogger.auth('Senha local migrada para PBKDF2', { email: cleanEmail });
          } catch (migErr) {
            if (window.LinsoraLogger) window.LinsoraLogger.error('Falha na migração de senha para hash', migErr);
          }
        }
      } else {
        // Sem senha definida: acesso em modo visitante
        isMatch = true;
      }

      if (!isMatch) {
        // --- RATE LIMITING: registrar falha e retornar mensagem adequada ---
        const updated = this._recordFailedAttempt(cleanEmail);
        const attemptsLeft = Math.max(0, 5 - updated.count);
        if (window.LinsoraLogger) window.LinsoraLogger.error('Senha incorreta no login local', { email: cleanEmail, count: updated.count });
        if (updated.lockedUntil) {
          return { success: false, message: 'Conta bloqueada por 15 minutos após 5 tentativas incorretas.', locked: true, remainingMs: updated.lockedUntil - Date.now() };
        }
        const hint = attemptsLeft > 0 ? ` (${attemptsLeft} tentativa${attemptsLeft !== 1 ? 's' : ''} restante${attemptsLeft !== 1 ? 's' : ''})` : '';
        return { success: false, message: `E-mail ou senha incorretos.${hint}` };
      }

      // --- RATE LIMITING: sucesso — zerar contador ---
      this._clearLoginAttempts(cleanEmail);
      this.currentUserId = existing.id;
      const db = await this.getDbData(existing.id, { id: existing.id, email: cleanEmail, name: existing.name || cleanEmail.split('@')[0] });
      await this.saveActiveLocalSession(db.user);
      if (window.LinsoraLogger) window.LinsoraLogger.auth('signInWithEmail local com sucesso', { email: cleanEmail }, existing.id);
      return { success: true, user: db.user };
    }

    const userId = this.generateLocalUserId(cleanEmail);
    const hashedPwd = await this.hashLocalPassword(password);
    const newRecord = { id: userId, email: cleanEmail, name: cleanEmail.split('@')[0], passwordHash: hashedPwd };
    this.saveLocalRegisteredUser(newRecord);

    // Auto-registro: não há tentativa falha — zerar contador por precaução
    this._clearLoginAttempts(cleanEmail);
    this.currentUserId = userId;
    const db = await this.getDbData(userId, { id: userId, email: cleanEmail, name: cleanEmail.split('@')[0] });
    await this.saveActiveLocalSession(db.user);
    if (window.LinsoraLogger) window.LinsoraLogger.auth('signInWithEmail auto-registro local', { email: cleanEmail }, userId);
    return { success: true, user: db.user };
  }

  async signUpWithEmail(name, email, password) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    const userName = name || cleanEmail.split('@')[0];
    if (window.LinsoraLogger) window.LinsoraLogger.auth('Iniciando signUpWithEmail', { name: userName, email: cleanEmail });

    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { full_name: userName } }
        });
        if (error) throw error;
        this.currentUserId = data.user.id;
        const db = await this.getDbData(data.user.id, { id: data.user.id, email: cleanEmail, name: userName });
        await this.saveActiveLocalSession(db.user);
        if (window.LinsoraLogger) window.LinsoraLogger.auth('signUpWithEmail Supabase com sucesso', { email: cleanEmail }, data.user.id);
        return { success: true, user: db.user };
      } catch (err) {
        const errMsg = this.mapAuthErrorMessage(err.message);
        if (window.LinsoraLogger) window.LinsoraLogger.error('Falha no signUpWithEmail Supabase', errMsg);
        return { success: false, message: errMsg };
      }
    }

    const registeredUsers = this.getLocalRegisteredUsers();
    if (registeredUsers[cleanEmail]) {
      const msg = 'Este e-mail já está cadastrado. Faça login para acessar.';
      if (window.LinsoraLogger) window.LinsoraLogger.error('Cadastro duplicado recusado', { email: cleanEmail });
      return { success: false, message: msg };
    }

    const userId = this.generateLocalUserId(cleanEmail);
    const hashedPwd = await this.hashLocalPassword(password);
    const newRecord = { id: userId, email: cleanEmail, name: userName, passwordHash: hashedPwd };
    this.saveLocalRegisteredUser(newRecord);

    this.currentUserId = userId;
    const db = await this.getDbData(userId, { id: userId, email: cleanEmail, name: userName });
    await this.saveActiveLocalSession(db.user);
    if (window.LinsoraLogger) window.LinsoraLogger.auth('signUpWithEmail local cadastrado com sucesso', { email: cleanEmail }, userId);
    return { success: true, user: db.user };
  }

  async signOut() {
    const previousUserId = this.currentUserId;
    try {
      // 1. Limpar memCache de todas as chaves de sessão Supabase
      Object.keys(_supabaseMemCache).forEach(k => {
        if (k.startsWith('sb-') || k === 'supabase.auth.token') delete _supabaseMemCache[k];
      });

      // 2. Remover sessão local persistida (IDB + localStorage + Capacitor Preferences)
      await this.removeActiveLocalSession();

      // 2b. S8C: remover snapshot financeiro local do usuário que está saindo.
      this.removeUserFinancialCache(previousUserId);

      // 3. Encerrar sessão no Supabase remoto (invalida refresh token)
      if (this.supabase) {
        await this.supabase.auth.signOut();
      }
    } catch (e) {
      if (window.LinsoraLogger) window.LinsoraLogger.error('Erro ao encerrar sessão', e, previousUserId);
    }
    this.currentUserId = 'guest';
    if (window.LinsoraLogger) window.LinsoraLogger.logout('Sessão encerrada com sucesso', previousUserId);
  }

  async resetPassword(email) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (this.supabase) {
      try {
        const { error } = await this.supabase.auth.resetPasswordForEmail(cleanEmail);
        if (error) throw error;
        return { success: true, message: 'Link de redefinição enviado para o seu e-mail!' };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }
    return { success: true, message: 'Solicitação de recuperação de senha enviada.' };
  }

  mapAuthErrorMessage(msg) {
    if (!msg) return 'Ocorreu um erro na autenticação.';
    const lower = msg.toLowerCase();
    if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
      return 'E-mail ou senha incorretos.';
    }
    if (lower.includes('user already registered') || lower.includes('already_exists')) {
      return 'Este e-mail já está cadastrado. Faça login para acessar.';
    }
    if (lower.includes('password should be at least')) {
      return 'A senha deve conter no mínimo 6 caracteres.';
    }
    return msg;
  }

  /* ------------------------------------------------------------------------
     BANCO DE DADOS ISOLADO POR USUÁRIO (ESTADO INICIAL 100% ZERADO E RLS)
     ------------------------------------------------------------------------ */

  getEmptyUserData(userObj) {
    return {
      user: {
        id: userObj?.id || 'usr_guest',
        name: userObj?.name || 'Novo Usuário',
        email: userObj?.email ? String(userObj.email).toLowerCase().trim() : 'usuario@linsora.com.br',
        avatar: userObj?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
        plan: 'PRO',
        isAiClassificationEnabled: true
      },
      accounts: [],
      cards: [],
      pixKeys: [],
      goals: [],
      fixedBills: [],
      recurringBills: [],
      occurrences: [],
      transactions: []
    };
  }

  async getDbData(userId, userObj = null) {
    const activeId = userId || this.currentUserId || 'guest';
    const key = `LINSORA_DB_CACHE_${activeId}`;
    const stored = localStorage.getItem(key);
    let localCache = stored ? JSON.parse(stored) : null;

    // Migração automática de dados de visitante (guest) se o cache do novo usuário estiver zerado
    if (!localCache || (
      (!localCache.transactions || localCache.transactions.length === 0) &&
      (!localCache.accounts || localCache.accounts.length === 0) &&
      (!localCache.goals || localCache.goals.length === 0)
    )) {
      const guestStored = localStorage.getItem('LINSORA_DB_CACHE_usr_guest') || localStorage.getItem('LINSORA_DB_CACHE_guest');
      if (guestStored) {
        try {
          const guestCache = JSON.parse(guestStored);
          if (guestCache && (guestCache.transactions?.length || guestCache.accounts?.length || guestCache.goals?.length)) {
            console.log('🔄 Migrando dados locais de visitante para o usuário:', activeId);
            localCache = {
              user: {
                ...(guestCache.user || {}),
                id: activeId,
                name: userObj?.name || guestCache.user?.name || 'Usuário',
                email: userObj?.email ? String(userObj.email).toLowerCase().trim() : (guestCache.user?.email || '')
              },
              accounts: (guestCache.accounts || []).map(a => ({ ...a, userId: activeId })),
              cards: (guestCache.cards || []).map(c => ({ ...c, userId: activeId })),
              transactions: (guestCache.transactions || []).map(t => ({ ...t, userId: activeId })),
              goals: (guestCache.goals || []).map(g => ({ ...g, userId: activeId })),
              pixKeys: (guestCache.pixKeys || []).map(p => ({ ...p, userId: activeId })),
              recurringBills: (guestCache.recurringBills || []).map(b => ({ ...b, userId: activeId })),
              occurrences: (guestCache.occurrences || []).map(o => ({ ...o, userId: activeId })),
              fixedBills: (guestCache.fixedBills || []).map(f => ({ ...f, userId: activeId }))
            };
            localStorage.setItem(key, JSON.stringify(localCache));
          }
        } catch (e) {
          console.warn('Falha na migração automática de dados de visitante:', e);
        }
      }
    }

    // Se estiver conectado ao Supabase remoto, busca via PostgREST/RLS
    if (this.supabase && activeId !== 'guest' && !activeId.startsWith('usr_')) {
      try {
        const [accRes, cardsRes, txRes, goalsRes, pixRes, billsRes, recBillsRes, occRes] = await Promise.all([
          this.supabase.from('accounts').select('*').eq('user_id', activeId),
          this.supabase.from('cards').select('*').eq('user_id', activeId),
          this.supabase.from('transactions').select('*').eq('user_id', activeId).order('date', { ascending: false }),
          this.supabase.from('goals').select('*').eq('user_id', activeId),
          this.supabase.from('pix_keys').select('*').eq('user_id', activeId),
          this.supabase.from('fixed_bills').select('*').eq('user_id', activeId),
          this.supabase.from('recurring_bills').select('*').eq('user_id', activeId),
          this.supabase.from('recurring_bill_occurrences').select('*').eq('user_id', activeId)
        ]);

        // Verificar e logar erros individuais por tabela sem abortar o merge
        const selectErrors = [
          accRes.error   && `accounts: ${accRes.error.message}`,
          cardsRes.error && `cards: ${cardsRes.error.message}`,
          txRes.error    && `transactions: ${txRes.error.message}`,
          goalsRes.error && `goals: ${goalsRes.error.message}`,
          pixRes.error   && `pix_keys: ${pixRes.error.message}`,
          billsRes.error && `fixed_bills: ${billsRes.error.message}`,
          recBillsRes.error && `recurring_bills: ${recBillsRes.error.message}`,
          occRes.error   && `recurring_bill_occurrences: ${occRes.error.message}`
        ].filter(Boolean);
        if (selectErrors.length > 0 && window.LinsoraLogger) {
          window.LinsoraLogger.error('Erros parciais na leitura do Supabase', selectErrors, activeId);
        }

        const remoteAccounts     = accRes.data   || [];
        const remoteCards        = cardsRes.data  || [];
        const remoteTransactions = txRes.data     || [];
        const remoteGoals        = goalsRes.data  || [];
        const remotePix          = pixRes.data    || [];
        const remoteBills        = billsRes.data  || [];
        // Normaliza snake_case remoto para o formato camelCase local
        const remoteRecBills = (recBillsRes.data || []).map(b => ({
          id: b.id, userId: b.user_id, title: b.title, amount: b.amount,
          category: b.category, frequency: b.frequency, dueDay: b.due_day,
          startDate: b.start_date, endDate: b.end_date, active: b.active
        }));
        const remoteOccs = (occRes.data || []).map(o => ({
          id: o.id, recurringBillId: o.recurring_bill_id, userId: o.user_id,
          dueDate: o.due_date, expectedAmount: o.expected_amount,
          paidAmount: o.paid_amount, status: o.status, paidAt: o.paid_at,
          transactionId: o.transaction_id, skippedReason: o.skipped_reason
        }));

        const hasRemoteData = remoteAccounts.length > 0 || remoteTransactions.length > 0 || remoteGoals.length > 0 || remoteCards.length > 0;
        const hasLocalData  = localCache && (localCache.transactions?.length > 0 || localCache.accounts?.length > 0 || localCache.cards?.length > 0 || localCache.goals?.length > 0);

        let mergedData;
        if (!hasRemoteData && hasLocalData) {
          mergedData = localCache;
          this.syncToSupabaseRemote(localCache, activeId);
        } else {
          // Mescla por ID garantindo que registros locais novos não sejam perdidos
          const mergeById = (remoteList, localList = []) => {
            const map = new Map();
            remoteList.forEach(item => map.set(item.id, item));
            localList.forEach(item => { if (!map.has(item.id)) map.set(item.id, item); });
            return Array.from(map.values());
          };

          mergedData = {
            user: {
              id: activeId,
              name: userObj?.name || localCache?.user?.name || 'Usuário',
              email: userObj?.email ? String(userObj.email).toLowerCase().trim() : (localCache?.user?.email || 'usuario@linsora.com.br'),
              avatar: userObj?.avatar || localCache?.user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
              plan: 'PRO',
              isAiClassificationEnabled: localCache?.user?.isAiClassificationEnabled !== false
            },
            accounts:     mergeById(remoteAccounts,     localCache?.accounts),
            cards:        mergeById(remoteCards,        localCache?.cards),
            transactions: mergeById(remoteTransactions, localCache?.transactions),
            goals:        mergeById(remoteGoals,        localCache?.goals),
            pixKeys:      mergeById(remotePix,          localCache?.pixKeys),
            fixedBills:   mergeById(remoteBills,        localCache?.fixedBills),
            recurringBills: mergeById(remoteRecBills,   localCache?.recurringBills),
            occurrences:  mergeById(remoteOccs,         localCache?.occurrences)
          };
        }

        localStorage.setItem(key, JSON.stringify(mergedData));
        if (window.LinsoraLogger) window.LinsoraLogger.read('Supabase Database & Local Cache', { accounts: mergedData.accounts.length, transactions: mergedData.transactions.length }, activeId);
        return mergedData;
      } catch (err) {
        if (window.LinsoraLogger) window.LinsoraLogger.error('Fallback para cache local isolado', err, activeId);
      }
    }

    if (localCache) {
      localCache.user.id = activeId;
      if (userObj) {
        if (userObj.name) localCache.user.name = userObj.name;
        if (userObj.email) localCache.user.email = String(userObj.email).toLowerCase().trim();
        if (userObj.avatar) localCache.user.avatar = userObj.avatar;
      }
      if (window.LinsoraLogger) window.LinsoraLogger.read('Local Cache DB', { accounts: (localCache.accounts || []).length, transactions: (localCache.transactions || []).length }, activeId);
      return localCache;
    }

    const emptyState = this.getEmptyUserData(userObj);
    localStorage.setItem(key, JSON.stringify(emptyState));
    if (window.LinsoraLogger) window.LinsoraLogger.read('Estado Inicial Zerado por Usuário', { userId: activeId }, activeId);
    return emptyState;
  }

  async syncToSupabaseRemote(data, userId) {
    if (!this.supabase || !userId || userId === 'guest' || userId.startsWith('usr_')) return { success: true, errors: [] };
    const errors = [];
    try {
      if (data.accounts?.length) {
        const accs = data.accounts.map(a => ({ id: a.id, user_id: userId, name: a.name, type: a.type, balance: a.balance, color: a.color, icon: a.icon }));
        const { error } = await this.supabase.from('accounts').upsert(accs);
        if (error) errors.push(`accounts: ${error.message}`);
      }
      if (data.cards?.length) {
        const cards = data.cards.map(c => ({ id: c.id, user_id: userId, name: c.name, brand: c.brand, last4: c.last4, limit_total: c.limitTotal, limit_used: c.limitUsed, closing_day: c.closingDay, due_day: c.dueDay }));
        const { error } = await this.supabase.from('cards').upsert(cards);
        if (error) errors.push(`cards: ${error.message}`);
      }
      if (data.goals?.length) {
        const goals = data.goals.map(g => ({ id: g.id, user_id: userId, title: g.title, target: g.target, current: g.current, category: g.category, deadline: g.deadline, icon: g.icon, color: g.color, monthly_contribution: g.monthlyContribution }));
        const { error } = await this.supabase.from('goals').upsert(goals);
        if (error) errors.push(`goals: ${error.message}`);
      }
      if (data.transactions?.length) {
        const txs = data.transactions.map(t => ({ id: t.id, user_id: userId, type: t.type, description: t.description, amount: t.amount, category: t.category, date: t.date, account: t.account, status: t.status, notes: t.notes }));
        const { error } = await this.supabase.from('transactions').upsert(txs);
        if (error) errors.push(`transactions: ${error.message}`);
      }
      if (data.recurringBills?.length) {
        const bills = data.recurringBills.map(b => ({ id: b.id, user_id: userId, title: b.title, amount: b.amount, category: b.category, frequency: b.frequency, due_day: b.dueDay, start_date: b.startDate, end_date: b.endDate, active: b.active !== false }));
        const { error } = await this.supabase.from('recurring_bills').upsert(bills);
        if (error) errors.push(`recurring_bills: ${error.message}`);
      }
      if (data.occurrences?.length) {
        const occs = data.occurrences.map(o => ({ id: o.id, recurring_bill_id: o.recurringBillId, user_id: userId, due_date: o.dueDate, expected_amount: o.expectedAmount, paid_amount: o.paidAmount, status: o.status, paid_at: o.paidAt, transaction_id: o.transactionId, skipped_reason: o.skippedReason || null }));
        const { error } = await this.supabase.from('recurring_bill_occurrences').upsert(occs);
        if (error) errors.push(`recurring_bill_occurrences: ${error.message}`);
      }
      if (data.user) {
        const profile = {
          id: userId,
          full_name: data.user.name,
          avatar_url: data.user.avatar,
          plan: data.user.plan,
          is_ai_enabled: data.user.isAiClassificationEnabled
        };
        const { error } = await this.supabase.from('profiles').upsert([profile]);
        if (error) errors.push(`profiles: ${error.message}`);
      }
    } catch (e) {
      errors.push(`sync_exception: ${e?.message || e}`);
    }
    if (errors.length > 0) {
      if (window.LinsoraLogger) window.LinsoraLogger.error('Erros na sincronização remota (dados salvos localmente)', errors, userId);
      return { success: false, errors };
    }
    return { success: true, errors: [] };
  }

  /* ------------------------------------------------------------------------
     DELETE REMOTO — Remove registro de uma tabela no Supabase pelo ID
     Tabelas suportadas: 'transactions' | 'accounts' | 'cards' | 'goals' |
                         'pix_keys' | 'fixed_bills' | 'recurring_bills' |
                         'recurring_bill_occurrences'
     Retorna { success: boolean, error: string|null }
     ------------------------------------------------------------------------ */
  async deleteDbRecord(table, recordId, userId) {
    const targetId = userId || this.currentUserId;
    if (!this.supabase || !targetId || targetId === 'guest' || targetId.startsWith('usr_')) {
      // Modo offline: exclusão já aplicada no estado local, nada a fazer remotamente
      return { success: true, error: null };
    }
    if (!recordId) return { success: false, error: 'ID do registro não informado.' };
    try {
      const { error } = await this.supabase
        .from(table)
        .delete()
        .eq('id', recordId)
        .eq('user_id', targetId); // RLS extra: garante que o usuário só exclui os próprios registros
      if (error) {
        if (window.LinsoraLogger) window.LinsoraLogger.error(`Falha ao excluir de ${table}`, { recordId, error: error.message }, targetId);
        return { success: false, error: error.message };
      }
      if (window.LinsoraLogger) window.LinsoraLogger.update(`DELETE ${table}`, { recordId }, targetId);
      return { success: true, error: null };
    } catch (e) {
      if (window.LinsoraLogger) window.LinsoraLogger.error(`Exceção ao excluir de ${table}`, e, targetId);
      return { success: false, error: e?.message || 'Erro desconhecido na exclusão remota.' };
    }
  }

  async saveDbData(data, userId = null) {
    const targetId = userId || data?.user?.id || this.currentUserId || 'guest';
    const key = `LINSORA_DB_CACHE_${targetId}`;

    // Forçar que o objeto do usuário sempre tenha o id correto
    if (data && data.user) {
      data.user.id = targetId;
      if (data.user.email) {
        data.user.email = String(data.user.email).toLowerCase().trim();
      }
    }

    // 1. Salvar localmente primeiro — garante persistência mesmo sem rede
    localStorage.setItem(key, JSON.stringify(data));

    // 2. Sincronizar remotamente — capturar e expor erros de escrita
    const syncResult = await this.syncToSupabaseRemote(data, targetId);
    if (syncResult && !syncResult.success && syncResult.errors?.length > 0) {
      // Emite evento customizado para que a UI possa exibir aviso ao usuário
      try {
        const evt = new CustomEvent('linsora:sync-error', {
          detail: { errors: syncResult.errors, savedLocally: true }
        });
        window.dispatchEvent(evt);
      } catch (_) { /* ambiente sem suporte a CustomEvent */ }
    }

    if (window.LinsoraLogger) window.LinsoraLogger.write('Local Cache DB', { targetId, transactionsCount: data?.transactions?.length || 0 }, targetId);
    return { data, syncResult };
  }
}

window.supabaseRepo = new SupabaseRepository();
