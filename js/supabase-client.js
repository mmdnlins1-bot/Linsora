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
    if (window.LinsoraGoogleAuth) {
      const activeGoogleUser = window.LinsoraGoogleAuth.getActiveSession();
      if (activeGoogleUser && activeGoogleUser.email) {
        this.currentUserId = activeGoogleUser.id;
        const db = await this.getDbData(activeGoogleUser.id, activeGoogleUser);
        return { success: true, user: db.user, db };
      }
    }

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

  async signInWithGoogleOAuth() {
    if (window.LinsoraGoogleAuth) {
      const res = await window.LinsoraGoogleAuth.signIn();
      if (res.success && res.user) {
        this.currentUserId = res.user.id;
        const db = await this.getDbData(res.user.id, res.user);
        this.saveActiveLocalSession(db.user);
        return { success: true, user: db.user };
      }
      return res;
    }

    if (this.supabase) {
      try {
        const redirectUrl = window.location.origin + window.location.pathname;
        const { data, error } = await this.supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: redirectUrl }
        });
        if (error) throw error;
        return { success: true, data };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }

    return { success: false, message: 'Não foi possível extrair dados da conta Google.' };
  }

  generateLocalUserId(email) {
    if (!email) return 'usr_guest';
    const clean = String(email).toLowerCase().trim();
    return 'usr_' + btoa(clean).replace(/=/g, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  }

  async signInWithEmail(email, password) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        this.currentUserId = data.user.id;
        const db = await this.getDbData(data.user.id, { id: data.user.id, email: data.user.email, name: cleanEmail.split('@')[0] });
        this.saveActiveLocalSession(db.user);
        return { success: true, user: db.user };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }

    const userId = this.generateLocalUserId(cleanEmail);
    this.currentUserId = userId;
    const db = await this.getDbData(userId, { id: userId, email: cleanEmail, name: cleanEmail.split('@')[0] });
    this.saveActiveLocalSession(db.user);
    return { success: true, user: db.user };
  }

  async signUpWithEmail(name, email, password) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        this.currentUserId = data.user.id;
        const db = await this.getDbData(data.user.id, { id: data.user.id, email: cleanEmail, name });
        this.saveActiveLocalSession(db.user);
        return { success: true, user: db.user };
      } catch (err) {
        return { success: false, message: this.mapAuthErrorMessage(err.message) };
      }
    }

    const userId = this.generateLocalUserId(cleanEmail);
    this.currentUserId = userId;
    const db = await this.getDbData(userId, { id: userId, email: cleanEmail, name: name || cleanEmail.split('@')[0] });
    this.saveActiveLocalSession(db.user);
    return { success: true, user: db.user };
  }

  async signOut() {
    try {
      localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION');
      localStorage.removeItem('linsora_google_session');
      if (this.supabase) {
        await this.supabase.auth.signOut();
      }
    } catch (e) {
      console.warn('Erro ao encerrar sessão:', e);
    }
    this.currentUserId = 'guest';
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

        const remoteAccounts = accRes.data || [];
        const remoteCards = cardsRes.data || [];
        const remoteTransactions = txRes.data || [];
        const remoteGoals = goalsRes.data || [];
        const remotePix = pixRes.data || [];
        const remoteBills = billsRes.data || [];

        const hasRemoteData = remoteAccounts.length > 0 || remoteTransactions.length > 0 || remoteGoals.length > 0 || remoteCards.length > 0;
        const hasLocalData = localCache && (localCache.transactions?.length > 0 || localCache.accounts?.length > 0 || localCache.cards?.length > 0 || localCache.goals?.length > 0);

        let mergedData;
        if (!hasRemoteData && hasLocalData) {
          mergedData = localCache;
        } else {
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
            accounts: hasRemoteData ? remoteAccounts : (localCache?.accounts || []),
            cards: hasRemoteData ? remoteCards : (localCache?.cards || []),
            transactions: hasRemoteData ? remoteTransactions : (localCache?.transactions || []),
            goals: hasRemoteData ? remoteGoals : (localCache?.goals || []),
            pixKeys: hasRemoteData ? remotePix : (localCache?.pixKeys || []),
            fixedBills: hasRemoteData ? remoteBills : (localCache?.fixedBills || [])
          };
        }

        localStorage.setItem(key, JSON.stringify(mergedData));
        return mergedData;
      } catch (err) {
        console.warn('Fallback para cache local isolado:', err);
      }
    }

    if (localCache) {
      localCache.user.id = activeId;
      if (userObj) {
        if (userObj.name) localCache.user.name = userObj.name;
        if (userObj.email) localCache.user.email = String(userObj.email).toLowerCase().trim();
        if (userObj.avatar) localCache.user.avatar = userObj.avatar;
      }
      return localCache;
    }

    const emptyState = this.getEmptyUserData(userObj);
    localStorage.setItem(key, JSON.stringify(emptyState));
    return emptyState;
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

    localStorage.setItem(key, JSON.stringify(data));
    return data;
  }
}

window.supabaseRepo = new SupabaseRepository();
