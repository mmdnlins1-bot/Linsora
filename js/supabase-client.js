/**
 * ============================================================================
 * LINSORA — CAMADA DE CLIENTE & REPOSITÓRIO SUPABASE AUTH (supabase-client.js)
 * Fluxo de Autenticação Oficial, Logout Seguro e Sincronização PostgreSQL / RLS
 * ============================================================================
 */

class SupabaseRepository {
  constructor() {
    this.configKey = 'LINSORA_SUPABASE_CONFIG';
    this.config = this.getSupabaseConfig();
    this.supabase = null;
    this.currentUserId = 'guest';
    
    this.initSupabaseSDK();
  }

  /**
   * Inicializa o cliente oficial do Supabase JS SDK se houver credenciais
   */
  initSupabaseSDK() {
    if (this.config.url && this.config.key && window.supabase) {
      try {
        this.supabase = window.supabase.createClient(this.config.url, this.config.key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        console.log('⚡ Supabase Client SDK inicializado com suporte estrito a RLS!');
      } catch (e) {
        console.warn('Erro ao inicializar Supabase SDK:', e);
      }
    }
  }

  getSupabaseConfig() {
    try {
      const stored = localStorage.getItem(this.configKey);
      return stored ? JSON.parse(stored) : { url: '', key: '', isConnected: false };
    } catch (e) {
      return { url: '', key: '', isConnected: false };
    }
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

  saveActiveLocalSession(userProfile) {
    try {
      if (userProfile && userProfile.id) {
        localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', JSON.stringify(userProfile));
      }
    } catch (e) {
      console.warn('Falha ao salvar sessão local:', e);
    }
  }

  getActiveLocalSession() {
    try {
      const raw = localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async checkActiveSession() {
    if (this.supabase) {
      try {
        const { data: { session }, error } = await this.supabase.auth.getSession();
        if (!error && session && session.user) {
          this.currentUserId = session.user.id;
          const userMeta = session.user.user_metadata || {};
          const db = await this.getDbData(session.user.id, {
            id: session.user.id,
            name: userMeta.full_name || userMeta.name || session.user.email.split('@')[0],
            email: session.user.email,
            avatar: userMeta.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'
          });
          this.saveActiveLocalSession(db.user);
          return { success: true, user: db.user, db };
        }
      } catch (e) {
        console.warn('Sessão ativa Supabase não encontrada:', e);
      }
    }

    const localSession = this.getActiveLocalSession();
    if (localSession && localSession.id) {
      this.currentUserId = localSession.id;
      const db = await this.getDbData(localSession.id, localSession);
      return { success: true, user: db.user, db };
    }

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
        this.saveActiveLocalSession(db.user);
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
      this.saveActiveLocalSession(db.user);
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
    this.saveActiveLocalSession(db.user);
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
        this.saveActiveLocalSession(db.user);
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
    this.saveActiveLocalSession(db.user);
    if (window.LinsoraLogger) window.LinsoraLogger.auth('signUpWithEmail local cadastrado com sucesso', { email: cleanEmail }, userId);
    return { success: true, user: db.user };
  }

  async signOut() {
    const previousUserId = this.currentUserId;
    try {
      localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION');
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
        isPinEnabled: false,
        pinCode: '1234',
        isAiClassificationEnabled: true
      },
      accounts: [],
      cards: [],
      pixKeys: [],
      goals: [],
      fixedBills: [],
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
        const [accRes, cardsRes, txRes, goalsRes, pixRes, billsRes] = await Promise.all([
          this.supabase.from('accounts').select('*').eq('user_id', activeId),
          this.supabase.from('cards').select('*').eq('user_id', activeId),
          this.supabase.from('transactions').select('*').eq('user_id', activeId).order('date', { ascending: false }),
          this.supabase.from('goals').select('*').eq('user_id', activeId),
          this.supabase.from('pix_keys').select('*').eq('user_id', activeId),
          this.supabase.from('fixed_bills').select('*').eq('user_id', activeId)
        ]);

        // Verificar e logar erros individuais por tabela sem abortar o merge
        const selectErrors = [
          accRes.error   && `accounts: ${accRes.error.message}`,
          cardsRes.error && `cards: ${cardsRes.error.message}`,
          txRes.error    && `transactions: ${txRes.error.message}`,
          goalsRes.error && `goals: ${goalsRes.error.message}`,
          pixRes.error   && `pix_keys: ${pixRes.error.message}`,
          billsRes.error && `fixed_bills: ${billsRes.error.message}`
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
              isPinEnabled: localCache?.user?.isPinEnabled || false,
              pinCode: localCache?.user?.pinCode || '1234',
              isAiClassificationEnabled: localCache?.user?.isAiClassificationEnabled !== false
            },
            accounts:     mergeById(remoteAccounts,     localCache?.accounts),
            cards:        mergeById(remoteCards,        localCache?.cards),
            transactions: mergeById(remoteTransactions, localCache?.transactions),
            goals:        mergeById(remoteGoals,        localCache?.goals),
            pixKeys:      mergeById(remotePix,          localCache?.pixKeys),
            fixedBills:   mergeById(remoteBills,        localCache?.fixedBills)
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
      if (data.user) {
        const profile = {
          id: userId,
          full_name: data.user.name,
          avatar_url: data.user.avatar,
          plan: data.user.plan,
          pin_code: data.user.pinCode,
          is_pin_enabled: data.user.isPinEnabled,
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
                         'pix_keys' | 'fixed_bills'
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
